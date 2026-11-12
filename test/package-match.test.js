'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { packageKey, DELIVERED_RE } = require('../package-match');

test('Amazon delivered subjects are recognised as deliveries', () => {
  assert.ok(DELIVERED_RE.test('Delivered 1 item: Household Supplies'));
  assert.ok(DELIVERED_RE.test('Delivered 3 items: Hardware, Industrial Hardware, and more'));
  assert.ok(DELIVERED_RE.test('Your package has been delivered'));
  assert.ok(!DELIVERED_RE.test('Shipped 1 item: Household Supplies'));
  assert.ok(!DELIVERED_RE.test('Out for delivery 1 item: Painting Supplies'));
});

test('shipped, out-for-delivery and delivered subjects share one key', () => {
  const k = packageKey('Shipped 2 items: Memory Cards, Electrical');
  assert.equal(k, 'memory cards, electrical');
  assert.equal(packageKey('Delivered 2 items: Memory Cards, Electrical'), k);
  assert.equal(packageKey('Out for delivery 1 item: Painting Supplies'), packageKey('Delivered 1 item: Painting Supplies'));
  assert.equal(packageKey('Delay in shipping: Latex Sealants'), packageKey('Shipped 1 item: Latex Sealants'));
});

test('subjects without a status prefix get no key', () => {
  assert.equal(packageKey('Your Debit Card has Shipped'), '');
  assert.equal(packageKey('USPS® Expected Delivery on Friday, November 13, 2026'), '');
  assert.equal(packageKey(''), '');
});
