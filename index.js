/**
 * TizenBrew Prime Video Ad-Free & Skip Module
 * High-performance injection script designed for Samsung Tizen Smart TVs.
 */

(function () {
  'use strict';

  // Configuration options
  const CONFIG = {
    enableAdSkipper: true,      // Automatically mutes and fast-forwards ads
    enableIntroSkipper: true,   // Automatically clicks "Skip Intro" & "Skip Recap"
    enableNextEpisode: true,    // Automatically plays next episode
    disableDarkOverlay: true,   // Removes dark background dimming during pause
    adPlaybackRate: 16,         // Speed to fast-forward ads (16x is maximum supported by HTML5)
    scanIntervalMs: 250         // Rate at which to scan the player DOM (4 times a second)
  };

  // State Management
  let isAdPlaying = false;
  let originalVolume = 1.0;
  let originalMuted = false;
  let osdTimeout = null;

  // Selectors matching Amazon Web Player (ATV SDK)
  const SELECTORS = {
    video: 'video',
    adTimeText: '.atvwebplayersdk-adtimeindicator-text',
    adContainer: '.atvwebplayersdk-adtimeindicator-container',
    adSkipBtn: '.adSkipButton, .atvwebplayersdk-adskip-button, .atvwebplayersdk-ad-skip-button',
    introSkipBtn: '.atvwebplayersdk-skipelement-button, .skip-element, .atvwebplayersdk-skip-button',
    nextEpisodeBtn: '.atvwebplayersdk-nextupcard-button, .atvwebplayersdk-next-episode-button, .fjtwui4',
    darkOverlay: '.fkpovp9, .atvwebplayersdk-player-container div:not([class]):not([tabindex]) > div[class]:not([style*="margin"])'
  };

  // Skip terms used for multi-language fallback matching
  const SKIP_TEXT_MATCHES = [
    'skip', 'skip intro', 'skip recap', 'skip ad', 'passer', 'saltar', 'intro überspringen', 'anuncio omitir',
    'siguiente', 'next episode', 'recap', 'next up'
  ];

  /**
   * Inject glassmorphic On-Screen Notification (OSD) to confirm activation on TV
   */
  function showOSD(message, duration = 4000) {
    if (document.getElementById('tb-prime-osd')) {
      document.getElementById('tb-prime-osd').remove();
    }

    const osd = document.createElement('div');
    osd.id = 'tb-prime-osd';
    osd.style.cssText = `
      position: fixed;
      top: 5%;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(15, 23, 42, 0.85);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      color: #ffffff;
      padding: 14px 28px;
      border-radius: 9999px;
      font-family: 'Segoe UI', Roboto, sans-serif;
      font-size: 16px;
      font-weight: 600;
      letter-spacing: 0.5px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4), 0 0 1px 1px rgba(255, 255, 255, 0.15);
      z-index: 2147483647;
      transition: opacity 0.5s ease, transform 0.5s cubic-bezier(0.16, 1, 0.3, 1);
      opacity: 0;
      transform: translate(-50%, -20px);
      display: flex;
      align-items: center;
      gap: 10px;
      pointer-events: none;
    `;

    osd.innerHTML = `
      <span style="color: #00a8e1; font-size: 18px;">✦</span>
      <span>${message}</span>
      <span style="color: #00a8e1; font-size: 10px; background: rgba(0, 168, 225, 0.2); padding: 2px 8px; border-radius: 4px; margin-left: 4px;">ACTIVE</span>
    `;

    document.body.appendChild(osd);

    // Trigger transition Reflow
    setTimeout(() => {
      osd.style.opacity = '1';
      osd.style.transform = 'translate(-50%, 0)';
    }, 50);

    if (osdTimeout) clearTimeout(osdTimeout);

    osdTimeout = setTimeout(() => {
      osd.style.opacity = '0';
      osd.style.transform = 'translate(-50%, -20px)';
      setTimeout(() => osd.remove(), 550);
    }, duration);
  }

  /**
   * Helper function to safe-click buttons using standard DOM events
   */
  function triggerClick(element) {
    if (!element) return;
    try {
      element.click();
      
      // Secondary fallback trigger via MouseEvents
      const clickEvent = new MouseEvent('click', {
        view: window,
        bubbles: true,
        cancelable: true
      });
      element.dispatchEvent(clickEvent);
    } catch (e) {
      console.error('[TizenBrew Prime] Failed to trigger click on button', e);
    }
  }

  /**
   * Search page for text-based button matches as a dynamic fallback
   */
  function scanTextButtons() {
    const buttons = document.querySelectorAll('button, div[role="button"], span');
    for (let i = 0; i < buttons.length; i++) {
      const element = buttons[i];
      const text = element.innerText ? element.innerText.toLowerCase().trim() : '';
      if (text.length > 0 && text.length < 25) {
        if (SKIP_TEXT_MATCHES.includes(text)) {
          triggerClick(element);
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Handles Ad Bypass Logic
   * Speeds up the HTML5 video element to bypass unskippable commercials.
   */
  function handleAdBypass(videoNode, adDetected) {
    if (adDetected) {
      if (!isAdPlaying) {
        // Just entered ad block
        isAdPlaying = true;
        originalVolume = videoNode.volume;
        originalMuted = videoNode.muted;
        
        console.log('[TizenBrew Prime] Ad detected. Muting and accelerating to ' + CONFIG.adPlaybackRate + 'x.');
        
        videoNode.muted = true;
        videoNode.playbackRate = CONFIG.adPlaybackRate;
        
        // Ensure speed remains accelerated if browser attempts to force normal speeds
        videoNode.onratechange = () => {
          if (isAdPlaying && videoNode.playbackRate !== CONFIG.adPlaybackRate) {
            videoNode.playbackRate = CONFIG.adPlaybackRate;
          }
        };
      }
    } else {
      if (isAdPlaying) {
        // Just exited ad block
        isAdPlaying = false;
        videoNode.playbackRate = 1.0;
        videoNode.muted = originalMuted;
        videoNode.volume = originalVolume;
        videoNode.onratechange = null; // Remove enforcement
        
        console.log('[TizenBrew Prime] Ad finished. Restoring video speed & volume.');
      }
    }
  }

  /**
   * Core Monitor Loop
   * Scans and skips ads/intros during video sessions.
   */
  function runMonitor() {
    const video = document.querySelector(SELECTORS.video);
    if (!video) return;

    // 1. Detect if an ad is currently playing on screen
    const adIndicator = document.querySelector(SELECTORS.adTimeText) || document.querySelector(SELECTORS.adContainer);
    let adDetected = !!adIndicator;

    // Supplementary: Check if there's an ongoing ad block based on the video source or duration anomalies if class names fail
    if (video.duration && video.duration < 90 && !adDetected) {
      // Very short media streams are typically commercial blocks
      adDetected = true;
    }

    if (CONFIG.enableAdSkipper) {
      handleAdBypass(video, adDetected);
      
      // Auto-click native Skip Ad button if available
      const skipAdBtn = document.querySelector(SELECTORS.adSkipBtn);
      if (skipAdBtn) {
        triggerClick(skipAdBtn);
      }
    }

    // 2. Click "Skip Intro" or "Skip Recap"
    if (CONFIG.enableIntroSkipper && !adDetected) {
      const skipIntroBtn = document.querySelector(SELECTORS.introSkipBtn);
      if (skipIntroBtn) {
        triggerClick(skipIntroBtn);
      }
    }

    // 3. Click "Next Episode" / "Up Next" 
    if (CONFIG.enableNextEpisode && !adDetected) {
      const nextBtn = document.querySelector(SELECTORS.nextEpisodeBtn);
      if (nextBtn) {
        triggerClick(nextBtn);
      }
    }

    // 4. Fallback text scanning if specific class names are obfuscated by update
    if (CONFIG.enableIntroSkipper || CONFIG.enableAdSkipper) {
      scanTextButtons();
    }
  }

  /**
   * Inject global stylesheets to fix UI annoyances (like dark blur overlay when pausing)
   */
  function injectStyles() {
    if (document.getElementById('tb-prime-styles')) return;

    const style = document.createElement('style');
    style.id = 'tb-prime-styles';
    
    let cssRules = '';
    
    // Rule to remove dark blur overlay during pause
    if (CONFIG.disableDarkOverlay) {
      cssRules += `
        ${SELECTORS.darkOverlay} {
          opacity: 0 !important;
          background: transparent !important;
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
        }
      `;
    }

    style.innerHTML = cssRules;
    document.head.appendChild(style);
  }

  /**
   * Main setup hook triggered on document load
   */
  function init() {
    console.log('[TizenBrew Prime] Initializing Ad Skipper Mod...');
    
    // Inject custom CSS styling
    injectStyles();

    // Trigger confirmation notification on TV screen
    setTimeout(() => {
      showOSD('Prime Video Ad-Skipper Loaded');
    }, 3000);

    // Start scanning interval
    setInterval(runMonitor, CONFIG.scanIntervalMs);
  }

  // Handle various stages of script initialization
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }

})();