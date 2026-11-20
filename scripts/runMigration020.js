import fs from "fs";
import path from "path";
import { db } from "../src/config/db.js";

async function run() {
  try {
    const sqlPath = path.join(process.cwd(), "server", "migrations", "020_create_faqs_table.sql");
    const sql = fs.readFileSync(sqlPath, "utf-8");
    await db.query(sql);
    console.log("Migration 020_create_faqs_table.sql executed successfully!");

    // Check count
    const [rows] = await db.query("SELECT COUNT(*) AS total FROM faqs");
    console.log(`Current FAQ count in database: ${rows[0].total}`);

    // Initial 5 FAQs seed if table is empty
    if (rows[0].total === 0) {
      const initialFaqs = [
        {
          question: "BanglaQR কী?",
          answer: "BanglaQR হলো একটি ডিজিটাল পেমেন্ট সলিউশন, যার মাধ্যমে ব্যবসায়ীরা QR কোড ব্যবহার করে সহজে পেমেন্ট গ্রহণ করতে পারেন। এটি ব্যবসায়ী ও গ্রাহক উভয়ের জন্য লেনদেনকে আরও সহজ, দ্রুত এবং সুবিধাজনক করে তোলে।",
          display_order: 1,
          status: "published",
        },
        {
          question: "কারা BanglaQR-এর জন্য আবেদন করতে পারবেন?",
          answer: "ছোট ও বড়—উভয় ধরনের ব্যবসা প্রতিষ্ঠান BanglaQR-এর জন্য আবেদন করতে পারবে। আবেদন করার সময় ব্যবসার ধরন ও প্রয়োজন অনুযায়ী মাইক্রো মার্চেন্ট (Micro Merchant) অথবা বিগ মার্চেন্ট (Big Merchant) ক্যাটাগরি নির্বাচন করতে হবে।",
          display_order: 2,
          status: "published",
        },
        {
          question: "মার্চেন্ট হিসেবে নিবন্ধন করতে কী কী কাগজপত্র প্রয়োজন?",
          answer: "প্রয়োজনীয় কাগজপত্র নির্ভর করবে আপনার ব্যবসার ক্যাটাগরি এবং নির্বাচিত ব্যাংক বা MFS (মোবাইল ফিন্যান্সিয়াল সার্ভিস) প্রদানকারীর নিয়মের ওপর। সাধারণত জাতীয় পরিচয়পত্র (NID), ছবি, ট্রেড লাইসেন্স, TIN সার্টিফিকেট এবং ব্যবসার ঠিকানার প্রমাণপত্র প্রয়োজন হতে পারে।",
          display_order: 3,
          status: "published",
        },
        {
          question: "BanglaQR মার্চেন্ট অ্যাকাউন্টের জন্য কীভাবে আবেদন করব?",
          answer: "প্রথমে আপনার উপযুক্ত মার্চেন্ট ক্যাটাগরি নির্বাচন করুন। এরপর অনলাইন আবেদন ফর্ম পূরণ করে ব্যবসা-সংক্রান্ত প্রয়োজনীয় তথ্য ও কাগজপত্র জমা দিন। আপনার পছন্দের ব্যাংক বা MFS প্রদানকারী নির্বাচন করে আবেদন জমা দিন। এরপর আবেদনটি যাচাই ও অনুমোদনের প্রক্রিয়ার মধ্য দিয়ে যাবে।",
          display_order: 4,
          status: "published",
        },
        {
          question: "আমার আবেদনের বর্তমান অবস্থা কীভাবে জানতে পারব?",
          answer: "আপনার মার্চেন্ট অ্যাকাউন্টে লগইন করে Merchant Dashboard থেকে আবেদনের বর্তমান অবস্থা দেখতে পারবেন। সেখানে যাচাইয়ের অগ্রগতি, আবেদনের আপডেট এবং অতিরিক্ত কোনো তথ্য বা কাগজপত্র প্রয়োজন কি না, তা জানতে পারবেন।",
          display_order: 5,
          status: "published",
        },
      ];

      for (const faq of initialFaqs) {
        await db.query(
          "INSERT INTO faqs (question, answer, display_order, status) VALUES (?, ?, ?, ?)",
          [faq.question, faq.answer, faq.display_order, faq.status]
        );
      }
      console.log("Successfully seeded 5 initial FAQs!");
    } else {
      console.log("FAQs table already has records; skipping seeding to avoid duplicates.");
    }

    process.exit(0);
  } catch (err) {
    console.error("Migration error:", err);
    process.exit(1);
  }
}

run();

