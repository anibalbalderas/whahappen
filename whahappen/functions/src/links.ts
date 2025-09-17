// functions/src/links.ts
import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// Dominio público donde vive tu landing /shared/:id
// Puedes sobreescribirlo con la env var APP_HOST si quieres.
const HOST =
  process.env.APP_HOST ||
  "https://whahappen.web.app"; // <-- cámbialo si tu hosting es otro

function shortCode(len = 7) {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < len; i++)
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

// callable: crea /shortlinks/{code} -> submissionId
export const createShortLink = functions.https.onCall(async (data) => {
  const submissionId = (data as any)?.submissionId as string;
  if (!submissionId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "submissionId requerido"
    );
  }

  // Genera un código libre
  let code = shortCode();
  for (let i = 0; i < 3; i++) {
    const snap = await db.doc(`shortlinks/${code}`).get();
    if (!snap.exists) break;
    code = shortCode();
  }

  await db.doc(`shortlinks/${code}`).set({
    submissionId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { shortLink: `${HOST}/s/${code}` };
});

// HTTP: /s/:code -> 302 /shared/{submissionId}
export const sRedirect = functions.https.onRequest(async (req, res) => {
  try {
    const code = (req.path.split("/").pop() || "").trim();
    if (!code) {
      res.status(400).send("Missing code");
      return;
    }
    const d = await db.doc(`shortlinks/${code}`).get();
    if (!d.exists) {
      res.status(404).send("Not found");
      return;
    }
    const { submissionId } = d.data() as any;
    if (!submissionId) {
      res.status(404).send("Invalid mapping");
      return;
    }
    const url = `${HOST}/shared/${submissionId}`;
    res.set("Cache-Control", "public, max-age=300");
    res.redirect(302, url);
  } catch (e) {
    console.error(e);
    res.status(500).send("Internal error");
  }
});
