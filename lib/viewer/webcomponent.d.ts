// The package's "exports" map hides its types.d.ts, so load it by path (adds the global MatterportViewer).
/// <reference path="../../node_modules/@matterport/webcomponent/types.d.ts" />
declare module "@matterport/webcomponent" {
  export type { MpSdk } from "../../node_modules/@matterport/webcomponent/built-bundle/sdk";
}
