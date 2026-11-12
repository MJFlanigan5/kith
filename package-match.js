'use strict';
// Amazon (and similar senders) email "Shipped 1 item: X", "Out for delivery 1 item: X"
// and "Delivered 1 item: X" with no tracking number. The item text after the status
// prefix is the only thing those emails share, so it is the key that ties them together.
const STATUS_PREFIX_RE = /^\s*(?:(?:re|fwd?):\s*)*(?:shipped|delivered|out for delivery|arriving(?: today| tomorrow)?|delay in shipping|delayed)\s*(?:\d+\s+items?)?\s*:\s*/i;

function packageKey(subject) {
  const s = String(subject || '');
  if (!STATUS_PREFIX_RE.test(s)) return '';
  return s.replace(STATUS_PREFIX_RE, '').trim().toLowerCase().replace(/\s+/g, ' ');
}

const DELIVERED_RE = /\b(has been delivered|was delivered|delivery complete|successfully delivered|your delivery is complete|package.*delivered|item.*delivered|delivered to your)\b|^\s*delivered\s+\d+\s+items?\b/i;

module.exports = { packageKey, DELIVERED_RE };
