module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {},
  },
  plugins: [],
  // Runtime AppStore bundles are not scanned; keep common layout utilities available.
  safelist: [
    'container',
    { pattern: /^max-w-(none|full|screen-(sm|md|lg|xl|2xl)|[0-9]xl|xs|sm|md|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl)$/ },
    { pattern: /^mx-(auto|0)$/ },
  ],
}
