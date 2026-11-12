'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { packageKey, samePackage, DELIVERED_RE } = require('../package-match');

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

test('marketplace and retailer subjects tie together', () => {
  assert.ok(samePackage('OUT FOR DELIVERY: Seagate SkyHawk 4TB ...', '📦PACKAGE DELIVERED: Seagate SkyHawk 4TB ...'));
  assert.ok(samePackage('Delivery Update: Aqara FP300 Presence...', '📦PACKAGE DELIVERED: Aqara FP300 Presence...'));
  assert.ok(samePackage('Order # WH48780465 Shipped: Your order is on its way, Michael!', 'Order #WH48780465 is Out for Delivery Today, Michael!'));
  assert.ok(!samePackage('Shipped 1 item: Books', 'Shipped 1 item: Hand Tools'));
  assert.ok(DELIVERED_RE.test('📦PACKAGE DELIVERED: Seagate SkyHawk 4TB ...'));
});

test('subjects without a status prefix get no key', () => {
  assert.equal(packageKey('Your Debit Card has Shipped'), '');
  assert.equal(packageKey('USPS® Expected Delivery on Friday, November 13, 2026'), '');
  assert.equal(packageKey(''), '');
});
