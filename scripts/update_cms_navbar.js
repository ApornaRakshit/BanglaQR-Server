import { db } from "../src/config/db.js";

async function run() {
  const [rows] = await db.execute("SELECT id, draft_content, published_content FROM cms_homepage");
  for (const row of rows) {
    let draft = typeof row.draft_content === "string" ? JSON.parse(row.draft_content) : row.draft_content;
    let pub = typeof row.published_content === "string" ? JSON.parse(row.published_content) : row.published_content;

    if (draft?.navbar) {
      draft.navbar.loginButtonText = "Login";
      draft.navbar.ctaButtonText = "Get Started";
      draft.navbar.loginButtonUrl = "/login";
      draft.navbar.ctaButtonUrl = "/register";
    }

    if (pub?.navbar) {
      pub.navbar.loginButtonText = "Login";
      pub.navbar.ctaButtonText = "Get Started";
      pub.navbar.loginButtonUrl = "/login";
      pub.navbar.ctaButtonUrl = "/register";
    }

    await db.execute(
      "UPDATE cms_homepage SET draft_content = ?, published_content = ? WHERE id = ?",
      [JSON.stringify(draft), JSON.stringify(pub), row.id]
    );
    console.log(`Successfully updated row ${row.id} in cms_homepage to Login and Get Started`);
  }
  await db.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

