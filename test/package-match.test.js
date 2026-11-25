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

test('a later email for a known tracking number updates status, date and a generic description', () => {
  const { emailUpdate } = require('../package-match');
  const row = { carrier: 'USPS', description: 'USPS package', expected_date: '2026-11-30', status: 'in_transit' };
  assert.deepEqual(
    emailUpdate(row, { description: 'Walnut samples', expected_date: '2026-11-28' }, 'USPS® Expected Delivery Changed for 9449008106245809217908'),
    { description: 'Walnut samples', expected_date: '2026-11-28' });
  assert.equal(emailUpdate(row, {}, 'Out for Delivery: UPS Update for package 1Z0X0R000310726624').status, 'Out for delivery');
  assert.equal(emailUpdate(row, {}, 'Delay: your FedEx package').status, 'Delayed');
  // a real description is kept; a repeat email with nothing new changes nothing
  assert.equal(emailUpdate({ ...row, description: 'Popcorn bowl' }, { description: 'Your order' }, 'Shipped'), null);
  assert.equal(emailUpdate(row, { expected_date: '2026-11-30' }, 'USPS® Expected Delivery on Monday'), null);
});
