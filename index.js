require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and body parsing
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 1. Initialize Firebase Admin SDK
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log('Firebase initialized via FIREBASE_SERVICE_ACCOUNT env.');
  } else if (
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  ) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
    console.log('Firebase initialized via individual credentials env.');
  } else {
    // Local development lookup
    const serviceAccount = require('./service-account.json');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log('Firebase initialized via local service-account.json');
  }
} catch (error) {
  console.error('Firebase Admin Init Warning:', error.message);
  console.log('Server is running but database access is unconfigured.');
}

// 2. Health check route
app.get('/', (req, res) => {
  res.status(200).send('IMB Webhook Server is active and running! 🚀');
});

// 3. IMB Webhook handler endpoint
app.post('/imb-webhook', async (req, res) => {
  try {
    const { order_id } = req.body;
    if (!order_id) {
      console.warn('Webhook received missing order_id.');
      return res.status(400).send('Bad Request: Missing order_id');
    }

    console.log(`Webhook triggered for order ID: ${order_id}`);

    // Retrieve active credentials from environment variables or fetch from Firestore
    let userToken = process.env.IMB_USER_TOKEN;
    let apiUrl = process.env.IMB_API_URL;

    // Fallback: Query credentials from Firestore if missing from environment
    if (!userToken || !apiUrl) {
      try {
        const configSnap = await admin.firestore().doc('appConfig/settings').get();
        if (configSnap.exists) {
          const data = configSnap.data();
          userToken = userToken || data.imbUserToken;
          apiUrl = apiUrl || data.imbApiUrl;
        }
      } catch (dbError) {
        console.error('Failed to read config from Firestore:', dbError.message);
      }
    }

    // Use absolute defaults (staging defaults you provided)
    userToken = userToken || '43436b3fa240f5b0100be86b8c502610';
    apiUrl = apiUrl || 'https://secure-stage.imb.org.in/';

    let cleanBaseUrl = apiUrl.replace(/\/$/, '');
    if (!cleanBaseUrl.endsWith('/api')) {
      cleanBaseUrl += '/api';
    }

    // Call IMB status check API securely to prevent client-side webhook spoofing
    const details = {
      user_token: userToken,
      order_id: order_id,
    };

    const formBody = Object.keys(details)
      .map((key) => encodeURIComponent(key) + '=' + encodeURIComponent(details[key]))
      .join('&');

    const apiResponse = await fetch(`${cleanBaseUrl}/check-order-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: formBody,
    });

    if (!apiResponse.ok) {
      console.error(`IMB Check Status API responded with status ${apiResponse.status}`);
      return res.status(502).send('Bad Gateway: Gateway status verification failed');
    }

    const statusData = await apiResponse.json();
    console.log('Gateway order status verification response:', statusData);

    const gatewayStatus = statusData.result && statusData.result.status ? String(statusData.result.status).toUpperCase() : '';
    const isCompleted = gatewayStatus === 'COMPLETED' || gatewayStatus === 'SUCCESS' || gatewayStatus === 'SUCCESSFUL';

    if (!statusData.status || !statusData.result || !isCompleted) {
      console.log(`Order ${order_id} verification check failed. Status: ${statusData.result ? statusData.result.status : 'PENDING'}`);
      return res.status(200).send('Verification Pending: Order is not completed');
    }

    // Payment is verified successfully. Find transaction in database.
    const db = admin.firestore();
    const txnsQuery = await db.collection('transactions')
      .where('orderId', '==', order_id)
      .limit(1)
      .get();

    if (txnsQuery.empty) {
      console.warn(`Transaction document with order ID ${order_id} not found in Firestore.`);
      return res.status(404).send('Not Found: Transaction not found');
    }

    const txnDoc = txnsQuery.docs[0];
    const txnData = txnDoc.data();

    // Prevent double processing if already credited
    if (txnData.status === 'completed' || txnData.status === 'approved') {
      console.log(`Transaction ${order_id} is already processed.`);
      return res.status(200).send('Success: Already credited');
    }

    const amount = Number(txnData.amount);
    const userId = txnData.userId;

    // Run transaction to credit balance atomically
    const userRef = db.collection('users').doc(userId);
    const txnRef = txnDoc.ref;

    await db.runTransaction(async (transaction) => {
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists) {
        throw new Error(`User profile ${userId} not found`);
      }

      const newBalance = Number(userSnap.data().balance || 0) + amount;
      transaction.update(userRef, { balance: newBalance });

      // Record transaction metadata
      const now = new Date();
      const dd = String(now.getDate()).padStart(2, '0');
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const yyyy = now.getFullYear();
      const hh = String(now.getHours() % 12 || 12).padStart(2, '0');
      const min = String(now.getMinutes()).padStart(2, '0');
      const ampm = now.getHours() >= 12 ? 'PM' : 'AM';
      const dateStr = `${dd}-${mm}-${yyyy} ${hh}:${min} ${ampm}`;

      transaction.update(txnRef, {
        status: 'completed',
        processedAt: dateStr,
        verificationSource: 'free-webhook-server',
        requestType: txnData.method || 'IMB_PAY',
        creditAt: dateStr,
      });
    });

    console.log(`Success! Credited ₹${amount} to user ${userId} for order ${order_id}`);
    res.status(200).send('Success: Wallet credited');
  } catch (error) {
    console.error('Webhook execution exception:', error);
    res.status(500).send(`Internal Server Error: ${error.message}`);
  }
});

// Start express server
app.listen(PORT, () => {
  console.log(`IMB Webhook Server is running on port ${PORT}`);
});
