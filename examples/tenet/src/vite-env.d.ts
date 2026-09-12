/// <reference types="vite/client" />

declare module "*.css?raw" {
  const content: string;
  export default content;
}

declare module "*.sql?raw" {
  const content: string;
  export default content;
}

declare module "*.module.css" {
  const classes: Record<string, string>;
  export default classes;
}
