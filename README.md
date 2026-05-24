# Free Webhook Server for IMB Payments

This is a lightweight Node.js Express server designed to receive webhook notifications from the **IMB Payment Gateway** (YPayPayment API) and credit wallet balances in your Firestore database automatically. 

It can be deployed **completely for free** on Render.com or Vercel without requiring any credit card!

---

## 🚀 Easy Deployment to Render.com (100% Free)

[Render](https://render.com) offers free hosting for Node.js apps. Follow these steps to host your webhook server for free:

### Step 1: Create a GitHub Repository
1. Push this folder (`imb-webhook-server`) or your entire codebase repository to **GitHub**.
2. Sign up or log into [Render.com](https://render.com) using your GitHub account.

### Step 2: Create a Free Web Service on Render
1. On the Render Dashboard, click **New +** and select **Web Service**.
2. Connect your GitHub repository.
3. Configure the following fields:
   *   **Name**: `imb-webhook-processor`
   *   **Language**: `Node`
   *   **Region**: Select the one closest to you (e.g. Singapore or Oregon)
   *   **Branch**: `main` (or your active branch)
   *   **Root Directory**: `imb-webhook-server` (if it's in a subfolder)
   *   **Build Command**: `npm install`
   *   **Start Command**: `npm start`
   *   **Instance Type**: **Free** (₹0 / month)

### Step 3: Add Your Firebase Service Account Credentials
Render needs permission to update your Firestore database:
1. Go to your **Firebase Console** -> **Project Settings** -> **Service Accounts**.
2. Click **Generate New Private Key** to download a `.json` file containing your credentials.
3. In your Render Web Service settings, click **Environment** -> **Add Environment Variable**.
4. Set these variables:
   *   `IMB_USER_TOKEN`: `43436b3fa240f5b0100be86b8c50261043436b3fa240f5b0100be86b8c502610` (or your live production key)
   *   `IMB_API_URL`: `https://secure-stage.imb.org.in/` (or your live production URL)
   *   `FIREBASE_SERVICE_ACCOUNT`: Copy the entire content of the downloaded `.json` service account file and paste it here as a single line string.

### Step 4: Configure Webhook on your IMB Dashboard
1. Click **Deploy Web Service** on Render.
2. Once Render finishes deployment, copy your unique live server URL (e.g. `https://imb-webhook-processor.onrender.com`).
3. Set your webhook URL in your **IMB Payments Merchant Dashboard** to:
   `https://imb-webhook-processor.onrender.com/imb-webhook`

---

## 🛠️ Local Development & Testing

1. Open your terminal inside this folder:
   ```bash
   cd imb-webhook-server
   npm install
   ```
2. Download your Firebase service account JSON key, rename it to `service-account.json` and save it directly in this directory.
3. Start the local server in development mode:
   ```bash
   npm run dev
   ```
4. Test using a tool like Postman by sending a `POST` request to `http://localhost:3000/imb-webhook` with a body of:
   ```json
   {
     "order_id": "YOUR_TEST_ORDER_ID"
   }
   ```
