'use strict';
// Shipping emails for one package rarely share a tracking number or subject. What they do
// share is the item text after a status prefix ("Shipped 1 item: X", "OUT FOR DELIVERY: X",
// "Delivery Update: X", "📦PACKAGE DELIVERED: X") or an order number ("Order #WH48780465").
// Those are the keys used to tie a package's emails together.
const STATUS_PREFIX_RE = /^[\s\p{Extended_Pictographic}️]*(?:(?:re|fwd?):\s*)*(?:shipped|delivered|package delivered|out for delivery|delivery update|arriving(?: today| tomorrow)?|delay in shipping|delayed)\s*(?:\d+\s+items?)?\s*:\s*/iu;

function packageKey(subject) {
  const s = String(subject || '');
  if (!STATUS_PREFIX_RE.test(s)) return '';
  return s.replace(STATUS_PREFIX_RE, '').replace(/\.{3}|…/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// "Order #WH48780465", "Order # WH48780465", "order #14172" -> "wh48780465"
function orderNumber(subject) {
  const m = String(subject || '').match(/\border\s*#\s*([A-Z0-9-]{4,})/i);
  return m ? m[1].toLowerCase() : '';
}

const DELIVERED_RE = /\b(has been delivered|was delivered|delivery complete|successfully delivered|your delivery is complete|package.*delivered|item.*delivered|delivered to your)\b|^\s*delivered\s+\d+\s+items?\b/i;

// True when two subjects describe the same package by item text or order number
function samePackage(a, b) {
  const ka = packageKey(a), oa = orderNumber(a);
  return !!((ka && ka === packageKey(b)) || (oa && oa === orderNumber(b)));
}

module.exports = { packageKey, orderNumber, samePackage, DELIVERED_RE };
