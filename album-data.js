/**
 * Memory Album Configuration & Media Data
 * Populated with Arohi photo collection.
 */

const ALBUM_DATA = {
  // Book physical appearance & dimensions
  book: {
    start: 'cover',             // 'cover' (starts closed) or 'spread' (starts open on first pages)
    size: 0.68,                 // Scale relative to viewport height (0.3 to 0.95)
    aspect: 0.76,               // Page width-to-height ratio (e.g. 0.76 for portrait)
    radius: 4,                  // Corner border radius in pixels
    paper: '#fbfaf6',           // Creamy paper color
    shadow: 0.6,                // Shadow intensity (0 to 1)
    spine: 0.55,                // Spine shading depth (0 to 1)
    thickness: 10,              // 3D paper stack thickness in pixels
    indicator: 'dots',          // 'dots', 'counter', or 'none'
    indicatorColor: 'rgba(23, 23, 23, 0.72)'
  },

  // Covers (front and back cover)
  covers: {
    color: '#222823',           // Dark pine/charcoal elegant hardcover color
    title: 'Arohi',             // Book title on front cover
    titleColor: '#f7f4ea',      // Title foil embossing color
    frontImage: 'assets/arohi/arohi_01.jpg',
    frontVideo: '',
    backImage: '',
    backVideo: ''
  },

  // Optional background typography behind the album
  headline: {
    text: '',
    scale: 37,
    color: 'rgb(23, 23, 23)',
    invert: false
  },

  // Animation & Physics parameters
  motion: {
    speed: 1.0,                 // Page flip speed multiplier (0.3 to 2.5)
    feel: 0.45,                 // Spring stiffness and damping (0 to 1)
    curl: 1.0,                  // Natural curl flexibility (0 to 1.6)
    tilt: true,                 // 3D perspective mouse tilt response
    tiltAmount: 6,              // Max tilt angle in degrees
    autoplay: false,            // Automatically turn pages on an idle timer
    interval: 3.2               // Idle timer interval in seconds
  },

  // Page background
  background: {
    color: '#e7e3da',           // Warm canvas background color
    image: '',
    video: '',
    opacity: 1.0,
    tint: '#000000',
    tintStrength: 0
  },

  // Sheets (each sheet has a front and a back page)
  sheets: [
    {
      id: 'sheet-0',
      frontCaption: '',
      frontFill: 'bleed',
      frontImage: 'assets/arohi/arohi_02.jpg',
      frontVideo: '',
      backCaption: '',
      backFill: 'bleed',
      backImage: 'assets/arohi/arohi_03.jpg',
      backVideo: ''
    },
    {
      id: 'sheet-1',
      frontCaption: '',
      frontFill: 'bleed',
      frontImage: 'assets/arohi/arohi_04.jpg',
      frontVideo: '',
      backCaption: '',
      backFill: 'bleed',
      backImage: 'assets/arohi/arohi_05.jpg',
      backVideo: ''
    },
    {
      id: 'sheet-2',
      frontCaption: '',
      frontFill: 'bleed',
      frontImage: 'assets/arohi/arohi_06.jpg',
      frontVideo: '',
      backCaption: '',
      backFill: 'bleed',
      backImage: 'assets/arohi/arohi_07.jpg',
      backVideo: ''
    },
    {
      id: 'sheet-3',
      frontCaption: '',
      frontFill: 'bleed',
      frontImage: 'assets/arohi/arohi_08.jpg',
      frontVideo: '',
      backCaption: '',
      backFill: 'bleed',
      backImage: 'assets/arohi/arohi_09.jpg',
      backVideo: ''
    },
    {
      id: 'sheet-4',
      frontCaption: '',
      frontFill: 'bleed',
      frontImage: 'assets/arohi/arohi_10.jpg',
      frontVideo: '',
      backCaption: '',
      backFill: 'bleed',
      backImage: 'assets/arohi/arohi_11.jpg',
      backVideo: ''
    },
    {
      id: 'sheet-5',
      frontCaption: '',
      frontFill: 'bleed',
      frontImage: 'assets/arohi/arohi_12.jpg',
      frontVideo: '',
      backCaption: '',
      backFill: 'bleed',
      backImage: 'assets/arohi/arohi_13.jpg',
      backVideo: ''
    },
    {
      id: 'sheet-6',
      frontCaption: '',
      frontFill: 'bleed',
      frontImage: 'assets/arohi/arohi_14.jpg',
      frontVideo: '',
      backCaption: '',
      backFill: 'framed',
      backImage: 'assets/arohi/arohi_15.jpg',
      backVideo: ''
    },
    {
      id: 'sheet-7',
      frontCaption: '',
      frontFill: 'bleed',
      frontImage: 'assets/arohi/arohi_16.jpg',
      frontVideo: '',
      backCaption: '',
      backFill: 'bleed',
      backImage: 'assets/arohi/arohi_17.jpg',
      backVideo: ''
    },
    {
      id: 'sheet-8',
      frontCaption: '',
      frontFill: 'bleed',
      frontImage: 'assets/arohi/arohi_18.jpg',
      frontVideo: '',
      backCaption: '',
      backFill: 'bleed',
      backImage: 'assets/arohi/arohi_19.jpg',
      backVideo: ''
    },
    {
      id: 'sheet-9',
      frontCaption: '',
      frontFill: 'bleed',
      frontImage: 'assets/arohi/arohi_20.jpg',
      frontVideo: '',
      backCaption: '',
      backFill: 'framed',
      backImage: 'assets/arohi/arohi_21.jpg',
      backVideo: ''
    },
    {
      id: 'sheet-10',
      frontCaption: '',
      frontFill: 'bleed',
      frontImage: 'assets/arohi/arohi_22.jpg',
      frontVideo: '',
      backCaption: '',
      backFill: 'bleed',
      backImage: 'assets/arohi/arohi_23.jpg',
      backVideo: ''
    },
    {
      id: 'sheet-11',
      frontCaption: '',
      frontFill: 'bleed',
      frontImage: 'assets/arohi/arohi_24.jpg',
      frontVideo: '',
      backCaption: '',
      backFill: 'bleed',
      backImage: 'assets/arohi/arohi_25.jpg',
      backVideo: ''
    },
    {
      id: 'sheet-12',
      frontCaption: '',
      frontFill: 'framed',
      frontImage: 'assets/arohi/arohi_26.jpg',
      frontVideo: '',
      backCaption: '',
      backFill: 'bleed',
      backImage: 'assets/arohi/arohi_27.jpg',
      backVideo: ''
    },
    {
      id: 'sheet-13',
      frontCaption: '',
      frontFill: 'bleed',
      frontImage: 'assets/arohi/arohi_28.jpg',
      frontVideo: '',
      backCaption: '',
      backFill: 'bleed',
      backImage: 'assets/arohi/arohi_29.jpg',
      backVideo: ''
    },
    {
      id: 'sheet-14',
      frontCaption: '',
      frontFill: 'bleed',
      frontImage: 'assets/arohi/arohi_30.jpg',
      frontVideo: '',
      backCaption: '',
      backFill: 'framed',
      backImage: '',
      backVideo: ''
    },
]
};

// Export for ES Module or global browser environment
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ALBUM_DATA;
}
