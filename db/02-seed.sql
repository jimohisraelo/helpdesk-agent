-- Demo data for "Kora Market", a fictional online store.

INSERT INTO customers (email, name) VALUES
  ('ada@example.com',   'Ada Okafor'),
  ('tunde@example.com', 'Tunde Bello'),
  ('zainab@example.com','Zainab Musa');

INSERT INTO orders (id, customer_id, status, items, total_ngn, eta, created_at) VALUES
  ('KM-10421', 1, 'shipped',
   '[{"name":"Wireless earbuds","qty":1,"price_ngn":38000},{"name":"USB-C cable","qty":2,"price_ngn":4500}]',
   47000, CURRENT_DATE + 2, now() - interval '3 days'),
  ('KM-10422', 1, 'delivered',
   '[{"name":"Ankara tote bag","qty":1,"price_ngn":15000}]',
   15000, CURRENT_DATE - 5, now() - interval '12 days'),
  ('KM-10430', 2, 'processing',
   '[{"name":"Rechargeable fan","qty":1,"price_ngn":62000}]',
   62000, CURRENT_DATE + 5, now() - interval '1 day'),
  ('KM-10433', 3, 'cancelled',
   '[{"name":"Blender","qty":1,"price_ngn":54000}]',
   54000, NULL, now() - interval '6 days');

INSERT INTO help_articles (slug, title, body) VALUES
  ('delivery-times', 'How long does delivery take?',
   'Lagos orders arrive in 1-2 business days. Other states take 3-5 business days. Orders placed after 2pm ship the next business day. You get an SMS and email with a tracking link once your order ships.'),
  ('track-order', 'How do I track my order?',
   'Open the tracking link in your shipping email, or give our support assistant your order ID (it starts with KM-) and the email you ordered with.'),
  ('returns-policy', 'Returns and refunds',
   'You can return most items within 7 days of delivery if they are unused and in the original packaging. Electronics must be returned within 7 days and include all accessories. Refunds go back to the original payment method within 5-7 business days after we receive the item. Cancelled orders are refunded automatically.'),
  ('damaged-item', 'My item arrived damaged',
   'Sorry about that. Take photos of the item and packaging within 48 hours of delivery and open a support ticket. We will arrange a free pickup and send a replacement or a full refund.'),
  ('change-address', 'Can I change my delivery address?',
   'You can change the address while the order is still processing. Once an order has shipped, the address cannot be changed, but you can ask the courier to hold it for pickup.'),
  ('payment-methods', 'Which payment methods do you accept?',
   'We accept debit cards (Verve, Visa, Mastercard), bank transfer, and pay on delivery for orders under 50,000 naira within Lagos.'),
  ('cancel-order', 'How do I cancel an order?',
   'Orders can be cancelled free of charge while they are still processing. Contact support with your order ID. Shipped orders cannot be cancelled, but they can be returned after delivery.');
