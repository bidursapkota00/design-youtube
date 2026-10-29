import {khaltiConfig} from "../config/khalti.js";

interface KhaltiInitiateResponse {
  pidx: string;
  payment_url: string;
  expires_at: string;
  expires_in: number;
}

interface KhaltiLookupResponse {
  pidx: string;
  total_amount: number;
  status: "Completed" | "Pending" | "Initiated" | "Expired" | "User canceled";
  transaction_id: string;
  fee: number;
  refunded: boolean;
}

/**
 * Initiates a payment session with Khalti.
 * @param {object} params Payment initialization parameters.
 * @return {Promise<KhaltiInitiateResponse>} The response from Khalti.
 */
export async function initiateKhaltiPayment(params: {
  amount: number; // in paisa
  purchaseOrderId: string;
  purchaseOrderName: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
}): Promise<KhaltiInitiateResponse> {
  if (!khaltiConfig.secretKey) {
    throw new Error(
      "Missing KHALTI_SECRET_KEY. " +
      "Please set KHALTI_SECRET_KEY in functions/.env",
    );
  }

  const response = await fetch(`${khaltiConfig.baseUrl}/epayment/initiate/`, {
    method: "POST",
    headers: {
      "Authorization": `Key ${khaltiConfig.secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      return_url: khaltiConfig.returnUrl,
      website_url: khaltiConfig.websiteUrl,
      amount: params.amount,
      purchase_order_id: params.purchaseOrderId,
      purchase_order_name: params.purchaseOrderName,
      customer_info: {
        name: params.customerName,
        email: params.customerEmail,
        phone: params.customerPhone,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Khalti initiation failed: ${error}`);
  }

  return response.json();
}

/**
 * Looks up and verifies a payment status with Khalti.
 * @param {string} pidx The Khalti payment index identifier.
 * @return {Promise<KhaltiLookupResponse>} The lookup response from Khalti.
 */
export async function verifyKhaltiPayment(
  pidx: string,
): Promise<KhaltiLookupResponse> {
  if (!khaltiConfig.secretKey) {
    throw new Error(
      "Missing KHALTI_SECRET_KEY. " +
      "Please set KHALTI_SECRET_KEY in functions/.env",
    );
  }

  const response = await fetch(`${khaltiConfig.baseUrl}/epayment/lookup/`, {
    method: "POST",
    headers: {
      "Authorization": `Key ${khaltiConfig.secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({pidx}),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Khalti lookup failed: ${error}`);
  }

  return response.json();
}
