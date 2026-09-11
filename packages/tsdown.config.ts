import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: [
    './fiber/index.ts',
    './thread/index.ts',
    './fabric/index.ts',
    './plugins/index.ts',
  ],
  clean: true,
  dts: true,
  minify: true,
  deps: {
    neverBundle: true
  }
})
