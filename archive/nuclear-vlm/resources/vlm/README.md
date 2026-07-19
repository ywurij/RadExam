# Embedded VLM bundle

RadExam starts a bundled `llama-server` process and uses its OpenAI-compatible
multimodal API instead of requiring Ollama. Runtime binaries and model files are
intentionally not committed to this repository.

To prepare a development bundle:

1. Run `npm run vlm:prepare-runtime`. This downloads the pinned llama.cpp release,
   verifies SHA-256, and extracts the current platform runtime.
2. Run `npm run vlm:verify`.
3. Start the Electron app with `npm run app:dev`.
4. Select the nuclear-medicine exam in the admin screen and install either the
   standard 2B model (about 1.55 GB) or optional 4B model (about 2.95 GB).
   The UI checks available disk space, supports pause/resume through `.part` files,
   and activates files only after size and SHA-256 verification.

At startup, Electron looks in the following order:

1. The user-data `vlm` directory (for assets downloaded after installation).
2. The packaged `resources/vlm` directory.

The pinned sources and hashes are in `download-manifest.json`. Both models use
Q4_K_M language weights and Q8_0 multimodal projectors. User-downloaded models are
stored under Electron's user-data directory and are not included in app updates.

If the manifest or any required asset is absent, RadExam keeps using Ollama.
Set `NUCLEAR_VLM_PROVIDER=ollama` to force Ollama, or `embedded` to force the
embedded OpenAI-compatible endpoint.
