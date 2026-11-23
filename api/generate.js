// Dy mënyra: "photo" (foto reale me FLUX, me ose pa foton tënde) dhe "draw" (vizatim i animuar nga Claude)
const hits = new Map(); // kufi i thjeshtë për IP (zëvendësoje me login + Stripe më vonë)
const LIMIT = 5, VIDEO_LIMIT = 2, WINDOW = 24 * 60 * 60 * 1000;

const claude = async (system, content, max = 300) => {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-haiku-5-5", max_tokens: max, system, messages: [{ role: "user", content }] }),
  });
  const j = await r.json();
  return j.content?.[0]?.text?.trim();
};

const imgBlock = (dataUrl) => {
  const [, type, data] = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/) || [];
  return type ? { type: "image", source: { type: "base64", media_type: type, data } } : null;
};

const SVG_SYS = `You are an illustrator. Reply with ONE complete SVG only, no markdown. viewBox="0 0 400 400", xmlns set, no scripts, no external assets, no text inside. Flat, colorful, charming, simple background. Animate with CSS @keyframes in a <style> tag: if something walks, swing legs and arms, bob the body, scroll the background; loop forever. If a photo is attached, draw a friendly cartoon resembling that person (hair, skin tone, glasses, clothes). Never name anyone. For sexual, gory, hateful content reply exactly: BLOCKED.`;

const PROMPT_SYS = `Turn the user's idea (Albanian or English) into one vivid English image prompt, max 60 words, keeping the action clear. If a photo is attached, write it as an edit instruction that keeps the same person (face, hair, identity) and puts them in the described scene, photorealistic. If the idea is sexual, violent/gory, hateful, or about a real public figure, reply exactly: BLOCKED. Output only the prompt.`;

const VIDEO_SYS = `Write ONE English video prompt, max 50 words, for a vertical TikTok-style clip: describe the subject, a clear action (e.g. walking), natural motion and camera movement. If a photo is attached, keep the same person and animate them doing the action. If the idea is sexual, violent/gory, hateful, or about a real public figure, reply exactly: BLOCKED. Output only the prompt.`;

const replicate = (model, input) =>
  fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`, "Content-Type": "application/json", Prefer: "wait" },
    body: JSON.stringify({ input }),
  }).then(r => r.json());

export default async function handler(req, res) {
  // Statusi i videos (kontrollohet çdo disa sekonda nga faqja)
  if (req.method === "GET" && req.query?.id) {
    const r = await fetch(`https://api.replicate.com/v1/predictions/${encodeURIComponent(req.query.id)}`, {
      headers: { Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}` },
    }).then(r => r.json());
    return res.status(200).json({
      status: r.status,
      video: typeof r.output === "string" ? r.output : null,
      error: r.status === "failed" || r.status === "canceled" ? "Videoja dështoi. Provo prapë." : undefined,
    });
  }
  // Test: hap /api/generate në shfletues, duhet të shohësh {"ok":true,...}
  if (req.method === "GET")
    return res.status(200).json({ ok: true, anthropicKey: !!process.env.ANTHROPIC_API_KEY, replicateKey: !!process.env.REPLICATE_API_TOKEN });
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const mode = ["draw", "video"].includes(req.body?.mode) ? req.body.mode : "photo";
  const ip = (req.headers["x-forwarded-for"] || "x").split(",")[0];
  const key = mode === "video" ? ip + "|v" : ip;
  const lim = mode === "video" ? VIDEO_LIMIT : LIMIT; // videot kushtojnë më shumë
  const now = Date.now();
  const list = (hits.get(key) || []).filter(t => now - t < WINDOW);
  if (list.length >= lim) return res.status(429).json({ error: "Ke arritur kufirin falas për sot." });

  const photo = typeof req.body?.photo === "string" ? req.body.photo : null;
  const text = String(req.body?.prompt || "").trim().slice(0, 300) || (photo ? "walking happily" : "");
  if (!text) return res.status(400).json({ error: "Shkruaj diçka." });

  const block = photo ? imgBlock(photo) : null;
  const content = (t) => (block ? [block, { type: "text", text: t }] : t);

  try {
    let out;
    if (mode === "draw") {
      const t = await claude(SVG_SYS, content(`Idea: ${text}`), 4000);
      if (!t || t === "BLOCKED") return res.status(400).json({ error: "Kjo kërkesë nuk lejohet." });
      const svg = t.match(/<svg[\s\S]*<\/svg>/i)?.[0]?.replace(/<script[\s\S]*?<\/script>/gi, "");
      if (!svg) throw new Error("no svg");
      out = { svg };
    } else if (mode === "video") {
      const vp = await claude(VIDEO_SYS, content(text));
      if (!vp) throw new Error("claude");
      if (vp === "BLOCKED") return res.status(400).json({ error: "Kjo kërkesë nuk lejohet." });
      let image = photo;
      if (!image) { // pa foto: krijo fillimisht një foto me FLUX, pastaj animoje
        const ip2 = await claude(PROMPT_SYS, text);
        if (!ip2 || ip2 === "BLOCKED") return res.status(400).json({ error: "Kjo kërkesë nuk lejohet." });
        const fj = await replicate("black-forest-labs/flux-schnell", { prompt: ip2, aspect_ratio: "9:16", output_format: "jpg" });
        image = Array.isArray(fj.output) ? fj.output[0] : null;
        if (!image) throw new Error("image");
      }
      const pj = await fetch("https://api.replicate.com/v1/models/wan-video/wan-2.2-i2v-fast/predictions", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ input: { prompt: vp, image, aspect_ratio: "9:16", resolution: "480p" } }),
      }).then(r => r.json());
      if (!pj.id) throw new Error("video");
      list.push(now); hits.set(key, list);
      return res.status(200).json({ id: pj.id, left: lim - list.length });
    } else {
      const prompt = await claude(PROMPT_SYS, content(text));
      if (!prompt) throw new Error("claude");
      if (prompt === "BLOCKED") return res.status(400).json({ error: "Kjo kërkesë nuk lejohet." });
      const rj = block
        ? await replicate("black-forest-labs/flux-kontext-pro", { prompt, input_image: photo, output_format: "jpg" })
        : await replicate("black-forest-labs/flux-schnell", { prompt, aspect_ratio: "1:1", output_format: "webp" });
      const image = Array.isArray(rj.output) ? rj.output[0] : rj.output;
      if (!image) throw new Error("image");
      out = { image };
    }
    list.push(now); hits.set(key, list);
    res.status(200).json({ ...out, left: lim - list.length });
  } catch (e) {
    res.status(500).json({ error: "Diçka shkoi keq. Provo prapë." });
  }
}
