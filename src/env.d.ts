/// <reference types="vite/client" />

// TypeScript modules can import Vue SFCs. Template/JavaScript checking is
// separate; this declaration does not claim to type-check component internals.
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent
  export default component
}
