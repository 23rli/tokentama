declare module '*.css';
declare module '*.svg' {
  const content: string;
  export default content;
}

interface Window {
  /** Webview-safe base URI for the extension's `media/` folder. */
  __ECO_MEDIA__?: string;
}
