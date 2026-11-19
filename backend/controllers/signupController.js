import { mailConfigured, sendAccountEmail } from "../config/accountEmail.js";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import prisma from "../db/prisma.js";

const lifetime = 30 * 60 * 1000;
const cooldown = 60 * 1000;
const digest = (token) => createHash("sha256").update(token).digest("hex");
const invalidLink = "This verification link is invalid or has expired. Start signup again for a new link.";

export async function requestSignup(req, res) {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ message: "Enter a valid email address." });
  }

  const { FRONTEND_URL } = process.env;
  const frontend = URL.canParse(FRONTEND_URL ?? "") ? new URL(FRONTEND_URL) : null;
  const localHttp = frontend?.protocol === "http:" && ["localhost", "127.0.0.1"].includes(frontend.hostname);
  if (!mailConfigured() || (frontend?.protocol !== "https:" && !localHttp)) {
    return res.status(503).json({ message: "Signup email is currently unavailable." });
  }

  let issuedDigest;
  try {
    const existing = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true }
    });
    if (existing) {
      return res.status(409).json({ message: "An account already uses this email. Sign in or choose Forgot password." });
    }

    const token = randomBytes(32).toString("hex");
    const tokenDigest = digest(token);
    issuedDigest = tokenDigest;
    const now = Date.now();
    const expiresAt = new Date(now + lifetime);
    const nextAllowed = new Date(now + lifetime - cooldown);
    const saved = await prisma.$executeRaw`
      INSERT INTO "pending_signups" ("email", "token_digest", "expires_at")
      VALUES (${email}, ${tokenDigest}, ${expiresAt})
      ON CONFLICT ("email") DO UPDATE
      SET "token_digest" = EXCLUDED."token_digest", "expires_at" = EXCLUDED."expires_at"
      WHERE "pending_signups"."expires_at" <= ${nextAllowed}
    `;
    if (!saved) {
      return res.status(429).json({ message: "Please wait one minute before requesting another verification email." });
    }

    const link = new URL("/verify-email", frontend);
    link.hash = new URLSearchParams({ token }).toString();
    const delivery = await sendAccountEmail({
      to: email,
      subject: "Verify your Careerly email",
      text: `Open this link to verify your email and create your Careerly account:\n${link.href}\n\nThis link expires in 30 minutes. If you did not request it, you can ignore this email.`
    });
    if (!delivery.ok) {
      const details = await delivery.json().catch(() => ({}));
      console.error("Signup email rejected:", delivery.status, details.name);
      await prisma.pendingSignup.deleteMany({ where: { token_digest: tokenDigest } });
      const testingRestriction = String(details.message || "").includes("testing emails");
      return res.status(503).json({
        message: testingRestriction
          ? "Email delivery is limited to the site's test inbox. The site owner needs to verify a sending domain to enable signup for other addresses."
          : "We couldn't send your verification email. Please try again later."
      });
    }
    return res.status(202).json({ message: "Your verification email has been sent. Open the link to finish creating your account." });
  } catch (error) {
    console.error("Signup verification request failed:", error.message);
    if (issuedDigest) {
      await prisma.pendingSignup.deleteMany({ where: { token_digest: issuedDigest } }).catch(() => {});
    }
    return res.status(503).json({ message: "Signup is temporarily unavailable. Please try again shortly." });
  }
}

export async function verifySignup(req, res) {
  const { token, password } = req.body ?? {};
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) {
    return res.status(400).json({ message: invalidLink });
  }
  if (!name || name.length > 255) {
    return res.status(400).json({ message: "Enter your full name using up to 255 characters." });
  }
  if (typeof password !== "string" || password.length < 8 || Buffer.byteLength(password) > 72) {
    return res.status(400).json({ message: "Use at least 8 characters and at most 72 UTF-8 bytes." });
  }

  const tokenDigest = digest(token);
  const pending = await prisma.pendingSignup.findUnique({ where: { token_digest: tokenDigest } });
  if (!pending || pending.expires_at <= new Date()) {
    return res.status(400).json({ message: invalidLink });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const created = await prisma.$transaction(async (tx) => {
    const consumed = await tx.pendingSignup.deleteMany({
      where: { token_digest: tokenDigest, expires_at: { gt: new Date() } }
    });
    if (!consumed.count) return false;
    const existing = await tx.user.findFirst({
      where: { email: { equals: pending.email, mode: "insensitive" } },
      select: { id: true }
    });
    if (existing) return false;
    await tx.user.create({ data: { name, email: pending.email, password_hash: passwordHash } });
    return true;
  });

  if (!created) return res.status(400).json({ message: invalidLink });
  return res.status(201).json({ message: "Email verified. You can now sign in." });
}
