/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_WS_URL?: string;
  readonly VITE_SCENE_TILE_URL?: string;
  readonly VITE_OFFLINE_MAP_CACHE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
