-- Seed: 002_phase1_catalogues_seed.sql
-- Description: BanglaQR Phase 1 - Initial Catalogues Seed Data (Idempotent INSERT IGNORE)

-- 1. Business Legal Structures Catalogue (11 Initial proposed entries)
INSERT INTO business_legal_structures (code, name_bn, name_en, description, is_active, display_order)
VALUES
  ('sole_proprietorship', 'একক মালিকানা', 'Sole Proprietorship', 'একক ব্যক্তির মালিকানাধীন পরিচালিত ব্যবসা প্রতিষ্ঠান', 1, 1),
  ('partnership_firm', 'অংশীদারি প্রতিষ্ঠান', 'Partnership Firm', 'দুই বা ততোধিক অংশীদার সমন্বয়ে গঠিত অংশীদারি কারবার', 1, 2),
  ('opc', 'এক ব্যক্তি কোম্পানি', 'One Person Company (OPC)', 'এক ব্যক্তি কর্তৃক গঠিত কোম্পানি আইন অনুযায়ী রেজিস্ট্রিকৃত প্রতিষ্ঠান', 1, 3),
  ('private_limited', 'প্রাইভেট লিমিটেড কোম্পানি', 'Private Limited Company', 'শেয়ার হোল্ডারদের দ্বারা গঠিত যৌথ মূলধনী প্রাইভেট কোম্পানি', 1, 4),
  ('public_limited', 'পাবলিক লিমিটেড কোম্পানি', 'Public Limited Company', 'শেয়ার বাজারে তালিকাভুক্ত বা পাবলিক লিমিটেড প্রতিষ্ঠান', 1, 5),
  ('cooperative_society', 'সমবায় সমিতি', 'Cooperative Society', 'সমবায় অধিদপ্তর কর্তৃক নিবন্ধিত সমবায় সমিতি', 1, 6),
  ('society_association', 'সোসাইটি / অ্যাসোসিয়েশন', 'Society / Association', 'সমিতি বা অ্যাসোসিয়েশন আইন অনুযায়ী নিবন্ধিত সংগঠন', 1, 7),
  ('ngo_non_profit', 'এনজিও / অলাভজনক প্রতিষ্ঠান', 'NGO / Non-Profit', 'সমাজকল্যাণ বা এনজিও বিষয়ক ব্যুরো নিবন্ধিত সংস্থা', 1, 8),
  ('government_entity', 'সরকারি প্রতিষ্ঠান', 'Government Entity', 'সরকারি বা আধাসরকারি কর্তৃপক্ষ / সংস্থা', 1, 9),
  ('foreign_company_branch', 'বিদেশি কোম্পানি / শাখা', 'Foreign Company / Branch Office', 'বিডা বা যথাযথ কর্তৃপক্ষ অনুমোদিত বিদেশি কোম্পানি বা লিয়াজোঁ অফিস', 1, 10),
  ('other', 'অন্যান্য', 'Other', 'অন্যান্য আইনি কাঠামো', 1, 11)
ON DUPLICATE KEY UPDATE name_bn = VALUES(name_bn), name_en = VALUES(name_en), is_active = VALUES(is_active);

-- 2. Industry Categories Master Data (18 Business-friendly Initial categories)
INSERT INTO industry_categories (code, name_bn, name_en, description, source_authority, is_active, display_order)
VALUES
  ('retail_grocery', 'খুচরা ও মুদি ব্যবসা', 'Retail & Grocery', 'মুদি সামগ্রী, খাদ্যদ্রব্য ও সাধারণ খুচরা বিক্রেতা', 'BanglaQR Internal Classification', 1, 1),
  ('wholesale_distribution', 'পাইকারি ও বিতরণ ব্যবসা', 'Wholesale & Distribution', 'পাইকারি পণ্য বিতরণ ও সরবরাহকারী প্রতিষ্ঠান', 'BanglaQR Internal Classification', 1, 2),
  ('clothing_textile', 'পোশাক ও বস্ত্র', 'Clothing & Textile', 'তৈরি পোশাক, বস্ত্র, বুটিক ও টেইলার্স', 'BanglaQR Internal Classification', 1, 3),
  ('electrical_electronics', 'ইলেকট্রিক্যাল ও ইলেকট্রনিক্স', 'Electrical & Electronics', 'বৈদ্যুতিক সামগ্রী, হোম অ্যাপ্লায়েন্স ও ইলেকট্রনিক্স', 'BanglaQR Internal Classification', 1, 4),
  ('mobile_telecom', 'মোবাইল ও টেলিযোগাযোগ', 'Mobile & Telecommunications', 'মোবাইল ফোন, গ্যাজেট, সার্ভিসিং ও টেলিকম সেবা', 'BanglaQR Internal Classification', 1, 5),
  ('food_beverage', 'খাদ্য ও পানীয়', 'Food & Beverage', 'রেস্তোরাঁ, ক্যাফে, মিষ্টি ও বেকারি পণ্য', 'BanglaQR Internal Classification', 1, 6),
  ('hotel_hospitality', 'হোটেল ও আতিথেয়তা', 'Hotel & Hospitality', 'হোটেল, মোটেল, রিসোর্ট ও ভ্রমণ আতিথেয়তা', 'BanglaQR Internal Classification', 1, 7),
  ('hardware_construction', 'হার্ডওয়্যার ও নির্মাণ সামগ্রী', 'Hardware & Construction', 'রং, রড-সিমেন্ট, স্যানিটারি ও হার্ডওয়্যার সামগ্রী', 'BanglaQR Internal Classification', 1, 8),
  ('automobile_transport', 'গাড়ি ও পরিবহন', 'Automobile & Transport', 'গাড়ি বিক্রয়, গ্যারেজ সার্ভিসিং ও পরিবহন ব্যবসা', 'BanglaQR Internal Classification', 1, 9),
  ('healthcare_pharmacy', 'স্বাস্থ্যসেবা ও ফার্মেসি', 'Healthcare & Pharmacy', 'ওষুধের দোকান, ফার্মেসি, ডায়াগনস্টিক ও ক্লিনিক', 'BanglaQR Internal Classification', 1, 10),
  ('education_training', 'শিক্ষা ও প্রশিক্ষণ', 'Education & Training', 'স্কুল, কলেজ, কোচিং সেন্টার ও প্রশিক্ষণ কেন্দ্র', 'BanglaQR Internal Classification', 1, 11),
  ('it_technology', 'তথ্যপ্রযুক্তি', 'IT & Technology', 'সফটওয়্যার, ওয়েব ডেভেলপমেন্ট, হার্ডওয়্যার ও আইটি সেবা', 'BanglaQR Internal Classification', 1, 12),
  ('financial_services', 'আর্থিক সেবা', 'Financial Services', 'ফিনটেক, এজেন্ট ব্যাংকিং, ইন্স্যুরেন্স ও আর্থিক পরামর্শ', 'BanglaQR Internal Classification', 1, 13),
  ('manufacturing_industry', 'উৎপাদন ও শিল্প', 'Manufacturing & Industry', 'কারখানা, প্রক্রিয়াজাতকরণ ও হালকা/ভারী উৎপাদন শিল্প', 'BanglaQR Internal Classification', 1, 14),
  ('agriculture_livestock', 'কৃষি ও পশুপালন', 'Agriculture & Livestock', 'কৃষি খামার, পোল্ট্রি, ডেইরি, সার ও বীজ ব্যবসা', 'BanglaQR Internal Classification', 1, 15),
  ('beauty_personal_services', 'সৌন্দর্য ও ব্যক্তিগত সেবা', 'Beauty & Personal Services', 'সেলুন, বিউটি পার্লার ও ব্যক্তিগত যত্ন সেবা', 'BanglaQR Internal Classification', 1, 16),
  ('real_estate_professional', 'আবাসন ও পেশাদার সেবা', 'Real Estate & Professional Services', 'রিয়েল এস্টেট, আইন, অডিট ও পেশাদার কনসালটেন্সি', 'BanglaQR Internal Classification', 1, 17),
  ('other_business_activities', 'অন্যান্য ব্যবসায়িক কার্যক্রম', 'Other Business Activities', 'অন্যান্য বিবিধ ব্যবসায়িক সেবা ও কার্যক্রম', 'BanglaQR Internal Classification', 1, 18)
ON DUPLICATE KEY UPDATE name_bn = VALUES(name_bn), name_en = VALUES(name_en), is_active = VALUES(is_active);

-- 3. Trade License Business Activities
INSERT INTO trade_license_activities (code, name_bn, name_en, source_authority, verification_status, is_active, display_order)
VALUES
  -- Retail & Grocery
  ('act_grocery_shop', 'মুদি দোকান', 'Grocery Shop', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 1),
  ('act_variety_grocery', 'মুদি মনিহারি', 'Variety Grocery & Stationery', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 2),
  ('act_super_shop', 'সুপার শপ', 'Super Shop / Mini Mart', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 3),
  ('act_fruit_shop', 'ফলের দোকান', 'Fruit Shop', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 4),
  ('act_vegetable_shop', 'সবজির দোকান', 'Vegetable Shop', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 5),
  ('act_fish_market', 'মাছের দোকান', 'Fish Market / Fish Shop', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 6),
  ('act_meat_shop', 'মাংসের দোকান', 'Meat Shop / Butcher', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 7),
  ('act_stationery_shop', 'স্টেশনারি দোকান', 'Stationery Shop', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 8),

  -- Clothing & Textile
  ('act_garments_retail', 'তৈরি পোশাকের দোকান', 'Readymade Garments Shop', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 9),
  ('act_saree_shop', 'শাড়ির দোকান', 'Saree & Traditional Wear', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 10),
  ('act_fabric_cloth_store', 'কাপড়ের দোকান', 'Fabric & Cloth Store', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 11),
  ('act_boutique_house', 'বুটিক হাউস', 'Boutique House', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 12),
  ('act_tailoring_shop', 'দর্জির দোকান', 'Tailoring Shop', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 13),
  ('act_garments_factory', 'গার্মেন্টস ফ্যাক্টরি', 'Garments Factory', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 14),

  -- Electrical & Electronics
  ('act_electrical_equipment', 'বৈদ্যুতিক সরঞ্জামের দোকান', 'Electrical Equipment Store', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 15),
  ('act_electronic_goods', 'ইলেকট্রিক সামগ্রীর দোকান', 'Electronic Goods Store', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 16),
  ('act_tv_fridge_appliances', 'টিভি ও ফ্রিজের দোকান', 'TV & Refrigerator Appliances', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 17),
  ('act_electronics_repair', 'ইলেকট্রনিক্স সার্ভিসিং', 'Electronics Repair & Servicing', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 18),
  ('act_computer_sales', 'কম্পিউটার বিক্রয়', 'Computer Sales', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 19),
  ('act_computer_hardware', 'কম্পিউটার হার্ডওয়্যার', 'Computer Hardware Store', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 20),

  -- Mobile & Telecom
  ('act_mobile_servicing', 'মোবাইল সার্ভিসিং', 'Mobile Servicing & Repair', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 21),
  ('act_mobile_phone_shop', 'মোবাইল ফোনের দোকান', 'Mobile Phone Shop', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 22),
  ('act_mobile_parts_accessories', 'মোবাইল পার্টস ও এক্সেসরিজ', 'Mobile Parts & Accessories', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 23),
  ('act_telecom_services', 'টেলিকমিউনিকেশন সেবা', 'Telecommunication Services', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 24),

  -- Food & Beverage
  ('act_tea_stall', 'চায়ের দোকান', 'Tea Stall / Refreshment', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 25),
  ('act_fast_food_shop', 'ফাস্ট ফুড শপ', 'Fast Food Shop', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 26),
  ('act_bakery_confectionery', 'বেকারি', 'Bakery & Confectionery', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 27),
  ('act_sweet_shop', 'মিষ্টির দোকান', 'Sweet Shop', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 28),
  ('act_restaurant', 'রেস্টুরেন্ট', 'Restaurant', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 29),
  ('act_food_manufacturing', 'খাদ্য উৎপাদন', 'Food Manufacturing', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 30),

  -- Hardware & Construction
  ('act_hardware_shop', 'হার্ডওয়্যার দোকান', 'Hardware Store', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 31),
  ('act_paint_shop', 'রঙের দোকান', 'Paint & Varnish Store', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 32),
  ('act_sanitary_goods', 'স্যানিটারি সামগ্রী', 'Sanitary & Plumbing Fixtures', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 33),
  ('act_tiles_mosaic', 'টাইলস ও মোজাইক', 'Tiles & Mosaic Store', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 34),
  ('act_cement_rod_dealer', 'সিমেন্ট ও রডের দোকান', 'Cement & Rod Building Materials', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 35),

  -- Healthcare
  ('act_pharmacy', 'ফার্মেসি', 'Pharmacy & Dispensary', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 36),
  ('act_diagnostic_center', 'ডায়াগনস্টিক সেন্টার', 'Diagnostic Center & Pathological Lab', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 37),
  ('act_clinic', 'ক্লিনিক', 'Clinic & Medical Consultation', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 38),
  ('act_hospital', 'হাসপাতাল', 'Hospital & Specialized Care', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 39),

  -- IT & Technology
  ('act_it_business', 'IT ব্যবসা', 'IT General Business', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 40),
  ('act_software_development', 'সফটওয়্যার ডেভেলপমেন্ট', 'Software Development & SaaS', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 41),
  ('act_computer_servicing', 'কম্পিউটার সার্ভিসিং', 'Computer Servicing & Support', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 42),
  ('act_web_development', 'ওয়েব ডেভেলপমেন্ট', 'Web Development & Design', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 43),
  ('act_digital_services', 'ডিজিটাল সেবা', 'Digital Marketing & IT Services', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 44),

  -- Manufacturing
  ('act_garments_manufacturing', 'গার্মেন্টস উৎপাদন', 'Garments Manufacturing', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 45),
  ('act_textile_manufacturing', 'টেক্সটাইল উৎপাদন', 'Textile Manufacturing', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 46),
  ('act_furniture_production', 'ফার্নিচার উৎপাদন', 'Furniture Production & Carpentry', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 47),
  ('act_plastic_products_mfg', 'প্লাস্টিক পণ্য উৎপাদন', 'Plastic Products Manufacturing', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 48),
  ('act_food_processing_mfg', 'খাদ্য প্রক্রিয়াজাতকরণ', 'Food Processing & Packaging', 'BanglaQR custom classification', 'banglaqr_proposed', 1, 49)
ON DUPLICATE KEY UPDATE name_bn = VALUES(name_bn), name_en = VALUES(name_en), is_active = VALUES(is_active);

-- 4. Industry and Business Activity Mapping (idempotent INSERT)
-- Mapping retail_grocery (id 1)
INSERT INTO industry_activity_mapping (industry_category_id, activity_id)
SELECT c.id, a.id FROM industry_categories c, trade_license_activities a
WHERE c.code = 'retail_grocery' AND a.code IN ('act_grocery_shop', 'act_variety_grocery', 'act_super_shop', 'act_fruit_shop', 'act_vegetable_shop', 'act_fish_market', 'act_meat_shop', 'act_stationery_shop')
ON DUPLICATE KEY UPDATE is_active = 1;

-- Mapping clothing_textile
INSERT INTO industry_activity_mapping (industry_category_id, activity_id)
SELECT c.id, a.id FROM industry_categories c, trade_license_activities a
WHERE c.code = 'clothing_textile' AND a.code IN ('act_garments_retail', 'act_saree_shop', 'act_fabric_cloth_store', 'act_boutique_house', 'act_tailoring_shop', 'act_garments_factory')
ON DUPLICATE KEY UPDATE is_active = 1;

-- Mapping electrical_electronics
INSERT INTO industry_activity_mapping (industry_category_id, activity_id)
SELECT c.id, a.id FROM industry_categories c, trade_license_activities a
WHERE c.code = 'electrical_electronics' AND a.code IN ('act_electrical_equipment', 'act_electronic_goods', 'act_tv_fridge_appliances', 'act_electronics_repair', 'act_computer_sales', 'act_computer_hardware')
ON DUPLICATE KEY UPDATE is_active = 1;

-- Mapping mobile_telecom
INSERT INTO industry_activity_mapping (industry_category_id, activity_id)
SELECT c.id, a.id FROM industry_categories c, trade_license_activities a
WHERE c.code = 'mobile_telecom' AND a.code IN ('act_mobile_servicing', 'act_mobile_phone_shop', 'act_mobile_parts_accessories', 'act_telecom_services')
ON DUPLICATE KEY UPDATE is_active = 1;

-- Mapping food_beverage
INSERT INTO industry_activity_mapping (industry_category_id, activity_id)
SELECT c.id, a.id FROM industry_categories c, trade_license_activities a
WHERE c.code = 'food_beverage' AND a.code IN ('act_tea_stall', 'act_fast_food_shop', 'act_bakery_confectionery', 'act_sweet_shop', 'act_restaurant', 'act_food_manufacturing')
ON DUPLICATE KEY UPDATE is_active = 1;

-- Mapping hardware_construction
INSERT INTO industry_activity_mapping (industry_category_id, activity_id)
SELECT c.id, a.id FROM industry_categories c, trade_license_activities a
WHERE c.code = 'hardware_construction' AND a.code IN ('act_hardware_shop', 'act_paint_shop', 'act_sanitary_goods', 'act_tiles_mosaic', 'act_cement_rod_dealer')
ON DUPLICATE KEY UPDATE is_active = 1;

-- Mapping healthcare_pharmacy
INSERT INTO industry_activity_mapping (industry_category_id, activity_id)
SELECT c.id, a.id FROM industry_categories c, trade_license_activities a
WHERE c.code = 'healthcare_pharmacy' AND a.code IN ('act_pharmacy', 'act_diagnostic_center', 'act_clinic', 'act_hospital')
ON DUPLICATE KEY UPDATE is_active = 1;

-- Mapping it_technology
INSERT INTO industry_activity_mapping (industry_category_id, activity_id)
SELECT c.id, a.id FROM industry_categories c, trade_license_activities a
WHERE c.code = 'it_technology' AND a.code IN ('act_it_business', 'act_software_development', 'act_computer_servicing', 'act_web_development', 'act_digital_services', 'act_computer_hardware')
ON DUPLICATE KEY UPDATE is_active = 1;

-- Mapping manufacturing_industry
INSERT INTO industry_activity_mapping (industry_category_id, activity_id)
SELECT c.id, a.id FROM industry_categories c, trade_license_activities a
WHERE c.code = 'manufacturing_industry' AND a.code IN ('act_garments_manufacturing', 'act_textile_manufacturing', 'act_furniture_production', 'act_plastic_products_mfg', 'act_food_processing_mfg', 'act_garments_factory', 'act_food_manufacturing')
ON DUPLICATE KEY UPDATE is_active = 1;

-- 5. Business Activity Segment Rules: STRICTLY TWO SEGMENTS ('micro', 'big'). Separate row for each. NO 'both'.
-- A. Common retail activities eligible for both Micro and Big merchants (2 rows per activity)
INSERT INTO business_activity_segment_rules (activity_id, merchant_segment, is_eligible)
SELECT a.id, 'micro', 1 FROM trade_license_activities a
WHERE a.code IN (
  'act_grocery_shop', 'act_variety_grocery', 'act_fruit_shop', 'act_vegetable_shop',
  'act_fish_market', 'act_meat_shop', 'act_stationery_shop', 'act_garments_retail',
  'act_saree_shop', 'act_fabric_cloth_store', 'act_boutique_house', 'act_tailoring_shop',
  'act_electrical_equipment', 'act_electronic_goods', 'act_electronics_repair', 'act_computer_sales',
  'act_computer_hardware', 'act_mobile_servicing', 'act_mobile_phone_shop', 'act_mobile_parts_accessories',
  'act_tea_stall', 'act_fast_food_shop', 'act_bakery_confectionery', 'act_sweet_shop',
  'act_hardware_shop', 'act_paint_shop', 'act_sanitary_goods', 'act_pharmacy',
  'act_computer_servicing', 'act_digital_services'
)
ON DUPLICATE KEY UPDATE is_eligible = 1;

INSERT INTO business_activity_segment_rules (activity_id, merchant_segment, is_eligible)
SELECT a.id, 'big', 1 FROM trade_license_activities a
WHERE a.code IN (
  'act_grocery_shop', 'act_variety_grocery', 'act_fruit_shop', 'act_vegetable_shop',
  'act_fish_market', 'act_meat_shop', 'act_stationery_shop', 'act_garments_retail',
  'act_saree_shop', 'act_fabric_cloth_store', 'act_boutique_house', 'act_tailoring_shop',
  'act_electrical_equipment', 'act_electronic_goods', 'act_electronics_repair', 'act_computer_sales',
  'act_computer_hardware', 'act_mobile_servicing', 'act_mobile_phone_shop', 'act_mobile_parts_accessories',
  'act_tea_stall', 'act_fast_food_shop', 'act_bakery_confectionery', 'act_sweet_shop',
  'act_hardware_shop', 'act_paint_shop', 'act_sanitary_goods', 'act_pharmacy',
  'act_computer_servicing', 'act_digital_services'
)
ON DUPLICATE KEY UPDATE is_eligible = 1;

-- B. Big-only activities (Factories, Super shops, Hospitals, Large manufacturing, Large IT, etc.)
INSERT INTO business_activity_segment_rules (activity_id, merchant_segment, is_eligible)
SELECT a.id, 'big', 1 FROM trade_license_activities a
WHERE a.code IN (
  'act_super_shop', 'act_garments_factory', 'act_tv_fridge_appliances', 'act_telecom_services',
  'act_restaurant', 'act_food_manufacturing', 'act_tiles_mosaic', 'act_cement_rod_dealer',
  'act_diagnostic_center', 'act_clinic', 'act_hospital', 'act_it_business',
  'act_software_development', 'act_web_development', 'act_garments_manufacturing',
  'act_textile_manufacturing', 'act_furniture_production', 'act_plastic_products_mfg',
  'act_food_processing_mfg'
)
ON DUPLICATE KEY UPDATE is_eligible = 1;

-- Explicitly mark Big-only activities as is_eligible = 0 for 'micro' to ensure clarity and safety
INSERT INTO business_activity_segment_rules (activity_id, merchant_segment, is_eligible)
SELECT a.id, 'micro', 0 FROM trade_license_activities a
WHERE a.code IN (
  'act_super_shop', 'act_garments_factory', 'act_hospital', 'act_garments_manufacturing',
  'act_textile_manufacturing', 'act_plastic_products_mfg'
)
ON DUPLICATE KEY UPDATE is_eligible = 0;
