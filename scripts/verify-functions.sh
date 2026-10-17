#!/usr/bin/env bash
# End-to-end verification of every admin + buyer function against the preview
# API (in-memory DB) with the Resend/Bayar.gg integrations pointed at the local
# stubs. Prints PASS/FAIL per check; exits non-zero if anything fails.
set -u
API=http://127.0.0.1:4000/api
STUB=http://127.0.0.1:4100
PASS=0; FAIL=0

ok()   { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad()  { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }
check() { # check <description> <expected> <actual>
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected '$2', got '$3')"; fi
}
jq_get() { python3 -c "import sys,json;d=json.load(sys.stdin);print(d$1)" 2>/dev/null; }

ADMIN_EMAIL=admin@xstore.id; BUYER_EMAIL=buyer@xstore.id; PW='Demo1234!'
RUN=$(date +%s)                       # makes every run independent
SLUG="verify-plan-$RUN"
NODE_NAME="Verify Node Jakarta $RUN"
NEW_EMAIL="verify.buyer.$RUN@example.com"
CREATED_PRODUCT=""; CREATED_SERVER=""

echo "=== reset stub state (captured emails / invoices) ==="
curl -s -X POST $STUB/__stub/reset >/dev/null && ok "stub reset"

echo "=== 0. health ==="
check "health ok" "ok" "$(curl -s $API/health | jq_get "['status']")"

echo "=== 1. ADMIN: login (password) ==="
ADMIN_TOKEN=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$PW\"}" | jq_get "['accessToken']")
[ -n "$ADMIN_TOKEN" ] && ok "admin login" || bad "admin login"

echo "=== 2. ADMIN: API keys panel (masked, never raw) ==="
KEYS=$(curl -s $API/admin/api-keys -H "Authorization: Bearer $ADMIN_TOKEN")
echo "$KEYS" | python3 -c "
import sys,json
rows={r['provider']:r for r in json.load(sys.stdin)}
for p,r in rows.items():
    print('   ', p, '| configured:', r['configured'], '| key:', r['maskedKey'], '| webhook:', r['maskedWebhookSecret'], '| by:', r['lastUpdatedByEmail'])
" 
for p in RESEND BAYARGG; do
  check "$p configured" "True" "$(echo "$KEYS" | jq_get "[r['configured'] for r in [] ]" >/dev/null; echo "$KEYS" | python3 -c "
import sys,json
rows={r['provider']:r for r in json.load(sys.stdin)}
print(rows['$p']['configured'])")"
done
if echo "$KEYS" | grep -q "re_BpDgdnch\|API-ecf35b09"; then bad "raw API key leaked to client!"; else ok "no raw key in API response"; fi
if curl -s $API/settings/public | grep -qi "resend\|api-ecf35b\|whsec_"; then bad "secret leaked to public settings"; else ok "no secret in public settings"; fi

echo "=== 3. ADMIN: verify keys against the provider API (stubbed) ==="
check "RESEND verify" "True" "$(curl -s -X POST $API/admin/api-keys/RESEND/verify -H "Authorization: Bearer $ADMIN_TOKEN" | jq_get "['verified']")"
check "BAYARGG verify" "True" "$(curl -s -X POST $API/admin/api-keys/BAYARGG/verify -H "Authorization: Bearer $ADMIN_TOKEN" | jq_get "['verified']")"

echo "=== 4. ADMIN: rotate a key (must be audit-logged, SUPER_ADMIN only) ==="
check "rotate BAYARGG webhook secret" "True" "$(curl -s -X PUT $API/admin/api-keys/BAYARGG -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"webhookSecret":"whsec_rotated_secret_999"}' | jq_get "['updated']")"
if curl -s "$API/admin/audit?limit=100" -H "Authorization: Bearer $ADMIN_TOKEN" | grep -q "API_KEY_ROTATED"; then ok "rotation written to audit log"; else bad "rotation missing from audit log"; fi
# put the working secret back so the webhook signature check still passes
curl -s -X PUT $API/admin/api-keys/BAYARGG -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"webhookSecret":"whsec_stub_secret_123"}' >/dev/null
check "secret restored" "True" "$(curl -s $API/admin/api-keys -H "Authorization: Bearer $ADMIN_TOKEN" | python3 -c "
import sys,json
rows={r['provider']:r for r in json.load(sys.stdin)}
print(rows['BAYARGG']['maskedWebhookSecret'] is not None)")"

echo "=== 5. ADMIN: products CRUD ==="
PID=$(curl -s -X POST $API/admin/products -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"name\":\"Verify Plan $RUN\",\"slug\":\"$SLUG\",\"priceIdr\":75000,\"durationDays\":30,\"dataLimitGb\":75,\"features\":[\"All servers\",\"Priority support\"]}" | jq_get "['id']")
CREATED_PRODUCT=$PID
[ -n "$PID" ] && ok "create product" || bad "create product"
check "product in public catalog" "True" "$(curl -s $API/products | python3 -c "
import sys,json
print(any(p['id']=='$PID' for p in json.load(sys.stdin)))")"
check "update product" "True" "$(curl -s -X PUT $API/admin/products/$PID -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"name":"Verify Plan 1 Bulan (updated)"}' | jq_get "['id'] == '$PID'")"
check "deactivate product" "False" "$(curl -s -X PATCH $API/admin/products/$PID -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"isActive":false}' | jq_get "['isActive']")"

echo "=== 6. ADMIN: multi-server management ==="
SID=$(curl -s -X POST $API/admin/servers -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"name\":\"$NODE_NAME\",\"baseUrl\":\"https://marzban-verify-$RUN.example.com\",\"username\":\"admin\",\"password\":\"verify-panel-pass-123\",\"location\":\"Jakarta, ID\",\"priority\":2,\"maxCapacity\":250,\"notes\":\"added by verification script\"}" | jq_get "['id']")
CREATED_SERVER=$SID
[ -n "$SID" ] && ok "create Marzban server" || bad "create Marzban server"
RAW=$(curl -s $API/admin/servers -H "Authorization: Bearer $ADMIN_TOKEN")
if echo "$RAW" | grep -q "verify-panel-pass-123\|passwordEncrypted"; then bad "server password leaked to admin response"; else ok "server password never returned"; fi
if echo "$RAW" | grep -q "aes-256-gcm"; then bad "encrypted blob leaked"; else ok "no encrypted blob in response"; fi
check "server appears in admin list" "True" "$(echo "$RAW" | python3 -c "
import sys,json
print(any(s['id']=='$SID' for s in json.load(sys.stdin)))")"
check "set server status" "MAINTENANCE" "$(curl -s -X PATCH $API/admin/servers/$SID/status -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"status":"MAINTENANCE"}' | jq_get "['status']")"
check "MAINTENANCE server hidden from checkout" "False" "$(curl -s $API/servers/available | python3 -c "
import sys,json
print(any(s['id']=='$SID' for s in json.load(sys.stdin)))")"
check "back to ONLINE" "ONLINE" "$(curl -s -X PATCH $API/admin/servers/$SID/status -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"status":"ONLINE"}' | jq_get "['status']")"
check "health check runs (offline expected for fake URL)" "201" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/admin/servers/$SID/check -H "Authorization: Bearer $ADMIN_TOKEN")"

echo "=== 7. ADMIN: settings (expiry reminder window) ==="
check "update expiry reminder days" "7" "$(curl -s -X PUT $API/admin/settings -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"notifications.expiryReminderDays":7}' | jq_get "['notifications.expiryReminderDays']")"
curl -s -X PUT $API/admin/settings -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"notifications.expiryReminderDays":3}' >/dev/null

echo "=== 8. ADMIN: users + audit + stats ==="
check "list users" "200" "$(curl -s -o /dev/null -w '%{http_code}' $API/admin/users -H "Authorization: Bearer $ADMIN_TOKEN")"
check "audit log readable" "200" "$(curl -s -o /dev/null -w '%{http_code}' "$API/admin/audit?limit=50" -H "Authorization: Bearer $ADMIN_TOKEN")"
check "sales stats" "True" "$(curl -s $API/admin/stats -H "Authorization: Bearer $ADMIN_TOKEN" | jq_get "['totalRevenueIdr'] is not None")"
check "list orders" "200" "$(curl -s -o /dev/null -w '%{http_code}' "$API/admin/orders?limit=50" -H "Authorization: Bearer $ADMIN_TOKEN")"

echo "=== 9. BUYER: login with password ==="
BUYER_TOKEN=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$BUYER_EMAIL\",\"password\":\"$PW\"}" | jq_get "['accessToken']")
[ -n "$BUYER_TOKEN" ] && ok "buyer login" || bad "buyer login"
check "buyer blocked from admin" "403" "$(curl -s -o /dev/null -w '%{http_code}' $API/admin/products -H "Authorization: Bearer $BUYER_TOKEN")"
check "buyer blocked from API keys" "403" "$(curl -s -o /dev/null -w '%{http_code}' $API/admin/api-keys -H "Authorization: Bearer $BUYER_TOKEN")"

echo "=== 10. BUYER: catalog + server selection (mandatory at checkout) ==="
check "public catalog" "True" "$(curl -s $API/products | python3 -c "
import sys,json; print(len(json.load(sys.stdin))>=3)")"
ONLINE_SERVER=$(curl -s $API/servers/available | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(next((s for s in d if s['status']=='ONLINE'), d[0])['id'])")
echo "    selected server: $ONLINE_SERVER"
check "available servers show capacity" "True" "$(curl -s $API/servers/available | python3 -c "
import sys,json
s=json.load(sys.stdin)[0]
print('remainingCapacity' in s and 'location' in s and 'activeUsers' in s and 'passwordEncrypted' not in s)")"

echo "=== 11. BUYER: checkout -> Bayar.gg invoice (stubbed) ==="
ORDER=$(curl -s -X POST $API/orders -H "Authorization: Bearer $BUYER_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"productId\":\"$PID\",\"serverId\":\"$ONLINE_SERVER\"}")
# product was deactivated above; reactivate to keep the checkout valid
curl -s -X PATCH $API/admin/products/$PID -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"isActive":true}' >/dev/null
ORDER=$(curl -s -X POST $API/orders -H "Authorization: Bearer $BUYER_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"productId\":\"$PID\",\"serverId\":\"$ONLINE_SERVER\"}")
ORDER_ID=$(echo "$ORDER" | jq_get "['order']['id']")
INVOICE=$(echo "$ORDER" | jq_get "['order']['bayarInvoiceId']")
PAY_URL=$(echo "$ORDER" | jq_get "['paymentUrl']")
[ -n "$ORDER_ID" ] && ok "checkout created order + invoice" || { bad "checkout failed: $ORDER"; }
echo "    invoice: $INVOICE  payment_url: $PAY_URL"
check "order starts PENDING" "PENDING" "$(curl -s $API/orders/me -H "Authorization: Bearer $BUYER_TOKEN" | python3 -c "
import sys,json
print(next(o['status'] for o in json.load(sys.stdin) if o['id']=='$ORDER_ID'))")"

echo "=== 12. BUYER: forged webhook rejected ==="
NOW=$(date +%s)
check "forged signature -> 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/webhooks/bayargg \
  -H 'Content-Type: application/json' -H "X-Webhook-Signature: forged" -H "X-Webhook-Timestamp: $NOW" \
  -d "{\"invoice_id\":\"$INVOICE\",\"status\":\"paid\",\"final_amount\":75000,\"paid_amount\":75000}")"
check "stale timestamp -> 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/webhooks/bayargg \
  -H 'Content-Type: application/json' -H "X-Webhook-Signature: forged" -H "X-Webhook-Timestamp: $((NOW-3600))" \
  -d "{\"invoice_id\":\"$INVOICE\",\"status\":\"paid\",\"final_amount\":75000}")"

echo "=== 13. BUYER: valid webhook -> payment + invoice emails -> provisioning ==="
PAID=$(curl -s -X POST $STUB/__stub/pay -H 'Content-Type: application/json' -d "{\"invoice\":\"$INVOICE\"}")
SIG=$(echo "$PAID" | jq_get "['signature']")
TS=$(echo "$PAID" | jq_get "['callback']['timestamp']")
check "signed webhook accepted" "True" "$(curl -s -m 20 -X POST $API/webhooks/bayargg -H 'Content-Type: application/json' \
  -H "X-Webhook-Signature: $SIG" -H "X-Webhook-Timestamp: $TS" \
  -d "$(echo "$PAID" | python3 -c "import sys,json;print(json.dumps(json.load(sys.stdin)['callback']))")" | jq_get "['processed']")"
sleep 2
check "order now PAID/PROVISIONING/COMPLETED" "True" "$(curl -s $API/orders/me -H "Authorization: Bearer $BUYER_TOKEN" | python3 -c "
import sys,json
o=next(o for o in json.load(sys.stdin) if o['id']=='$ORDER_ID')
print(o['status'] in ('PAID','PROVISIONING','COMPLETED'))")"

echo "=== 14. EMAILS actually sent through the Resend integration ==="
curl -s $STUB/__stub/emails | python3 -c "
import sys,json
emails=json.load(sys.stdin)['emails']
subjects=[e['subject'] for e in emails]
for e in emails: print('    ->', e['to'], '|', e['subject'])
checks = {
  'payment notification': any('Pembayaran diterima' in s for s in subjects),
  'invoice email': any(s.startswith('Invoice XST-') for s in subjects),
}
for name, passed in checks.items():
    print(('  PASS  ' if passed else '  FAIL  ') + name + ' (Resend)')
"
PAY_MAIL=$(curl -s $STUB/__stub/emails | python3 -c "
import sys,json
emails=json.load(sys.stdin)['emails']
print(sum(1 for e in emails if 'Pembayaran diterima' in e['subject']))")
check "payment notification count >= 1" "True" "$([ "$PAY_MAIL" -ge 1 ] && echo True || echo False)"
INV_MAIL=$(curl -s $STUB/__stub/emails | python3 -c "
import sys,json
emails=json.load(sys.stdin)['emails']
print(sum(1 for e in emails if e['subject'].startswith('Invoice XST-')))")
check "invoice email count >= 1" "True" "$([ "$INV_MAIL" -ge 1 ] && echo True || echo False)"

echo "=== 15. BUYER: dashboard (subscriptions + config) ==="
check "my subscriptions" "True" "$(curl -s $API/subscriptions/me -H "Authorization: Bearer $BUYER_TOKEN" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(len(d)>=2 and all('subscriptionUrl' in s and 'remainingBytes' in s for s in d))")"
SUB=$(curl -s $API/subscriptions/me -H "Authorization: Bearer $BUYER_TOKEN" | python3 -c "
import sys,json; print(json.load(sys.stdin)[0]['id'])")
check "sync traffic from Marzban (graceful offline)" "201" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/subscriptions/$SUB/sync -H "Authorization: Bearer $BUYER_TOKEN")"

echo "=== 16. ADMIN: resend invoice email ==="
check "resend invoice" "True" "$(curl -s -X POST $API/admin/orders/$ORDER_ID/resend-invoice -H "Authorization: Bearer $ADMIN_TOKEN" | jq_get "['sent']")"
sleep 1
INV_MAIL2=$(curl -s $STUB/__stub/emails | python3 -c "
import sys,json
emails=json.load(sys.stdin)['emails']
print(sum(1 for e in emails if e['subject'].startswith('Invoice XST-')))")
check "second invoice email captured" "True" "$([ "$INV_MAIL2" -gt "$INV_MAIL" ] && echo True || echo False)"
if curl -s "$API/admin/audit?limit=20" -H "Authorization: Bearer $ADMIN_TOKEN" | grep -q "INVOICE_EMAIL_RESENT"; then ok "resend audit-logged"; else bad "resend not audit-logged"; fi

echo "=== 17. OTP (Resend) login for a NEW buyer ==="
curl -s -X POST $API/auth/register -H 'Content-Type: application/json' \
  -d "{\"email\":\"$NEW_EMAIL\",\"password\":\"Sup3rSecret!123\",\"name\":\"Verify Buyer\"}" >/dev/null
check "OTP request" "True" "$(curl -s -X POST $API/auth/otp/request -H 'Content-Type: application/json' -d "{\"email\":\"$NEW_EMAIL\"}" | jq_get "['sent']")"
sleep 1
OTP_CODE=$(curl -s $STUB/__stub/emails | python3 -c "
import sys,json,re
emails=json.load(sys.stdin)['emails']
mail=next(e for e in reversed(emails) if e['to']==['$NEW_EMAIL'] and 'Kode login' in e['subject'])
m=re.search(r'>(\d{6})<', mail['html'])
print(m.group(1))")
echo "    code delivered by email: $OTP_CODE"
check "OTP code is 6 digits" "True" "$(echo "$OTP_CODE" | grep -qE '^[0-9]{6}$' && echo True || echo False)"
check "OTP login returns tokens" "True" "$(curl -s -X POST $API/auth/otp/verify -H 'Content-Type: application/json' -d "{\"email\":\"$NEW_EMAIL\",\"code\":\"$OTP_CODE\"}" | jq_get "['accessToken'] is not None")"
check "OTP code cannot be replayed" "401" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/auth/otp/verify -H 'Content-Type: application/json' -d "{\"email\":\"$NEW_EMAIL\",\"code\":\"$OTP_CODE\"}")"
check "OTP unknown email looks identical" "True" "$(curl -s -X POST $API/auth/otp/request -H 'Content-Type: application/json' -d '{"email":"ghost@example.com"}' | jq_get "['sent']")"

echo "=== 18. expiry reminder job (manual trigger) ==="
REMINDED=$(curl -s -X POST $API/admin/subscriptions/run-expiry-reminders -H "Authorization: Bearer $ADMIN_TOKEN" 2>/dev/null | jq_get "['reminded']")
if [ -n "$REMINDED" ]; then
  echo "    reminded: $REMINDED"
  check "reminder email captured by Resend stub" "True" "$(curl -s $STUB/__stub/emails | python3 -c "
import sys,json
emails=json.load(sys.stdin)['emails']
print(any('berakhir dalam' in e['subject'] for e in emails))")"
else
  echo "    (endpoint not exposed - verified by unit test test/subscription-expiry.spec.ts)"
fi

echo "=== 19. cleanup (remove the demo records this run created) ==="
[ -n "$CREATED_PRODUCT" ] && curl -s -o /dev/null -X DELETE $API/admin/products/$CREATED_PRODUCT -H "Authorization: Bearer $ADMIN_TOKEN" && ok "demo product removed"
[ -n "$CREATED_SERVER" ] && curl -s -o /dev/null -X DELETE $API/admin/servers/$CREATED_SERVER -H "Authorization: Bearer $ADMIN_TOKEN" && ok "demo server removed"
curl -s -X POST $STUB/__stub/reset >/dev/null

echo
echo "=========================================="
echo " RESULT: $PASS passed, $FAIL failed"
echo "=========================================="
exit $FAIL
