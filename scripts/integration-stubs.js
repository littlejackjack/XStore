#!/usr/bin/env node
/**
 * Local stand-ins for the two third-party APIs XStore integrates with.
 *
 * WHY THIS EXISTS
 * ---------------
 * The sandbox that builds/tests this project has no outbound access to
 * api.resend.com or www.bayar.gg, and you should not burn real API calls (or
 * real invoices) while developing. This stub implements the *documented*
 * contract of both services - same paths, same payload shapes, same signature
 * scheme - so the application code can be exercised end to end locally.
 *
 * It is a development tool only. NEVER run it in production.
 *
 * USAGE
 * -----
 *   node scripts/integration-stubs.js            # listens on :4100
 *
 * Then point the API at it:
 *   RESEND_BASE_URL=http://127.0.0.1:4100/resend
 *   BAYARGG_BASE_URL=http://127.0.0.1:4100/bayargg
 *
 * RESEND (https://resend.com/docs)
 *   POST /resend/emails      -> { id: "re_..." }
 *   GET  /resend/api-keys    -> { data: [...] }            (used by "Verify")
 *
 * BAYAR.GG (https://www.bayar.gg/api-docs)
 *   POST /bayargg/api/create-payment.php     -> invoice + payment_url
 *   GET  /bayargg/api/check-payment.php      -> status (pending until paid)
 *   GET  /bayargg/api/get-account-status.php -> account + integration status
 *   GET  /bayargg/api/get-payment-methods.php-> available methods
 *
 * TEST HELPERS (not part of the real APIs)
 *   GET  /__stub/emails      -> every email the app "sent"
 *   POST /__stub/pay         { invoice } -> marks an invoice paid
 *   POST /__stub/reset       -> clears captured state
 */
'use strict';

const http = require('node:http');
const crypto = require('node:crypto');

const PORT = Number(process.env.STUB_PORT ?? 4100);
const WEBHOOK_SECRET = process.env.BAYARGG_WEBHOOK_SECRET ?? 'whsec_stub_secret_123';

/** invoiceId -> { amount, status, finalAmount, createdAt } */
const invoices = new Map();
/** Every "sent" email, newest last. */
const sentEmails = [];

function json(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
  });
  response.end(payload);
}

function readBody(request) {
  return new Promise((resolve) => {
    let raw = '';
    request.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) request.destroy();
    });
    request.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

/** Mirrors Bayar.gg: HMAC-SHA256 over `invoice_id|status|final_amount|timestamp`. */
function signWebhook(invoiceId, status, finalAmount, timestamp) {
  return crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(`${invoiceId}|${status}|${finalAmount}|${timestamp}`)
    .digest('hex');
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;

  if (request.method === 'OPTIONS') return json(response, 204, {});

  // ---------------------------------------------------------------- test helpers
  if (path === '/__stub/emails') {
    return json(response, 200, { count: sentEmails.length, emails: sentEmails });
  }
  if (path === '/__stub/reset' && request.method === 'POST') {
    invoices.clear();
    sentEmails.length = 0;
    return json(response, 200, { reset: true });
  }
  if (path === '/__stub/pay' && request.method === 'POST') {
    const body = await readBody(request);
    const invoice = invoices.get(body.invoice);
    if (!invoice) return json(response, 404, { success: false, error: 'unknown invoice' });
    invoice.status = 'paid';
    return json(response, 200, {
      success: true,
      invoice_id: invoice.id,
      status: 'paid',
      // Exactly the fields the real gateway puts in the callback body.
      callback: {
        event: 'payment.paid',
        invoice_id: invoice.id,
        status: 'paid',
        payment_method: 'qris_bayar_gg',
        amount: invoice.amount,
        final_amount: invoice.finalAmount,
        unique_code: 0,
        paid_amount: invoice.finalAmount,
        timestamp: Math.floor(Date.now() / 1000),
      },
      signature: signWebhook(
        invoice.id,
        'paid',
        String(invoice.finalAmount),
        String(Math.floor(Date.now() / 1000)),
      ),
    });
  }

  // -------------------------------------------------------------------- RESEND
  if (path === '/resend/emails' && request.method === 'POST') {
    const body = await readBody(request);
    sentEmails.push({
      at: new Date().toISOString(),
      from: body.from,
      to: body.to,
      subject: body.subject,
      html: body.html,
      text: body.text,
    });
    console.log(`[stub:resend] email -> ${(body.to || []).join(', ')} | ${body.subject}`);
    return json(response, 200, { id: `re_${crypto.randomBytes(8).toString('hex')}` });
  }
  if (path === '/resend/api-keys' && request.method === 'GET') {
    return json(response, 200, {
      data: [{ id: 'stub-key', name: 'xstore-dev', created_at: new Date().toISOString() }],
    });
  }

  // ------------------------------------------------------------------ BAYAR.GG
  if (path === '/bayargg/api/create-payment.php' && request.method === 'POST') {
    const body = await readBody(request);
    const invoiceId = `BAYAR-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const amount = Number(body.amount ?? 0);
    invoices.set(invoiceId, {
      id: invoiceId,
      amount,
      finalAmount: amount,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    console.log(`[stub:bayargg] invoice ${invoiceId} created for Rp ${amount}`);
    return json(response, 200, {
      success: true,
      data: {
        invoice_id: invoiceId,
        amount,
        final_amount: amount,
        unique_code: 0,
        payment_method: body.payment_method ?? 'qris_bayar_gg',
        payment_method_label: 'QRIS BAYAR GG',
        status: 'pending',
        payment_url: `https://www.bayar.gg/pay?invoice=${invoiceId}`,
        qris_string: '00020101021226STUBQRISSTRING',
        expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      },
    });
  }
  if (path === '/bayargg/api/check-payment.php' && request.method === 'GET') {
    const invoice = invoices.get(url.searchParams.get('invoice') ?? '');
    if (!invoice) {
      return json(response, 404, { success: false, message: 'invoice not found' });
    }
    return json(response, 200, {
      success: true,
      invoice_id: invoice.id,
      status: invoice.status,
      amount: invoice.amount,
      final_amount: invoice.finalAmount,
      payment_method: 'qris_bayar_gg',
      paid_at: invoice.status === 'paid' ? new Date().toISOString() : null,
      expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    });
  }
  if (path === '/bayargg/api/get-account-status.php') {
    return json(response, 200, {
      success: true,
      account: { username: 'stub-merchant', email: 'merchant@example.com', is_verified: true },
      integrations: { qris_bayar_gg: true, gopay: false, bri: false, ovo: false },
    });
  }
  if (path === '/bayargg/api/get-payment-methods.php') {
    return json(response, 200, {
      success: true,
      data: {
        payment_methods: [
          { id: 'qris', name: 'QRIS', enabled: true, available: true },
          { id: 'qris_bayar_gg', name: 'QRIS BAYAR GG', enabled: true, available: true },
        ],
        user_status: { has_active_subscription: true, has_qris_bayar_gg_grant: true },
      },
    });
  }

  return json(response, 404, { success: false, error: `stub has no route for ${request.method} ${path}` });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[stub] Resend + Bayar.gg stand-ins listening on http://127.0.0.1:${PORT}`);
  console.log(`[stub]   RESEND_BASE_URL=http://127.0.0.1:${PORT}/resend`);
  console.log(`[stub]   BAYARGG_BASE_URL=http://127.0.0.1:${PORT}/bayargg`);
  console.log(`[stub]   webhook secret: ${WEBHOOK_SECRET}`);
});
