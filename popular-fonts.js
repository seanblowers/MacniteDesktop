// Curated popular font casks from Homebrew. Any cask whose token starts
// with `font-` is shown in the full Fonts grid; this list bubbles the most
// commonly-installed ones to the top.
export const POPULAR_FONTS = [
  // Coding
  'font-jetbrains-mono',
  'font-fira-code',
  'font-cascadia-code',
  'font-cascadia-mono',
  'font-monaspace',
  'font-geist-mono',
  'font-hack',
  'font-iosevka',
  'font-victor-mono',
  'font-mononoki',
  'font-source-code-pro',
  'font-ibm-plex-mono',
  'font-meslo-lg-nerd-font',

  // UI / text
  'font-inter',
  'font-geist',
  'font-roboto',
  'font-roboto-mono',
  'font-open-sans',
  'font-lato',
  'font-poppins',
  'font-source-sans-3',
  'font-source-serif-4',
  'font-ibm-plex-sans',
  'font-ibm-plex-serif',
  'font-merriweather',
  'font-noto-sans',
  'font-work-sans',
  'font-nunito',
  'font-rubik',
].map(token => ({ kind: 'cask', token }));
