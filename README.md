# Foto AI

Tri mënyra: **Foto reale** (FLUX), **Vizatim i animuar** (Claude) dhe **Video** (vertikal, si TikTok, nga foto jote ose nga teksti; ~1-2 min, kufi 2 në ditë sepse kushton më shumë).

1. Merr çelësat: ANTHROPIC_API_KEY (console.anthropic.com) dhe REPLICATE_API_TOKEN (replicate.com).
2. Hidhe folderin në GitHub, pastaj Vercel -> New Project -> importo.
3. Vercel -> Settings -> Environment Variables: vendos të dy çelësat. Redeploy.
4. Gati. Pastaj shtohet login + Stripe për abonim mujor.

Test: hap https://EMRI-YT.vercel.app/api/generate. Duhet të shohësh {"ok":true,"anthropicKey":true,"replicateKey":true}. Nëse del 404, folderi api nuk u ngarkua. Nëse një çelës është false, vendose te Environment Variables dhe bëj Redeploy.
