import React from 'react';

const baseProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

export function WheelLogoIcon({ className = 'ico ico-lg' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...baseProps}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v6M12 15v6M3 12h6M15 12h6" />
    </svg>
  );
}

export function ActivityIcon({ className = 'ico ico-sm' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...baseProps}>
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}

export function BoxIcon({ className = 'ico ico-sm' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...baseProps}>
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
    </svg>
  );
}

export function TerminalIcon({ className = 'ico ico-sm' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...baseProps}>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

export function CpuIcon({ className = 'ico' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...baseProps}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M9 9h6v6H9Z" />
      <path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2" />
    </svg>
  );
}

export function UsbIcon({ className = 'ico' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...baseProps}>
      <path d="M10 7v14M10 7l-3 3M10 7l3 3M4 13v2a3 3 0 0 0 3 3h3M17 11v4a3 3 0 0 1-3 3h-4" />
      <circle cx="4" cy="11" r="1.5" />
      <rect x="15.5" y="8" width="3" height="3" rx="0.5" />
    </svg>
  );
}

export function PlugIcon({ className = 'ico ico-sm' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...baseProps}>
      <path d="M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
    </svg>
  );
}

export function WifiIcon({ className = 'ico' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...baseProps}>
      <path d="M5 12.55a11 11 0 0 1 14.08 0" />
      <path d="M1.42 9a16 16 0 0 1 21.16 0" />
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
      <circle cx="12" cy="20" r="1" />
    </svg>
  );
}

export function GlobeIcon({ className = 'ico' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...baseProps}>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z" />
    </svg>
  );
}

export function RadioIcon({ className = 'ico' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...baseProps}>
      <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" />
      <path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5" />
      <circle cx="12" cy="12" r="2" />
      <path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5" />
      <path d="M19.1 4.9C23 8.8 23 15.1 19.1 19" />
    </svg>
  );
}

export function RotateCcwIcon({ className = 'ico ico-sm' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...baseProps}>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

export function TrashIcon({ className = 'ico ico-sm' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...baseProps}>
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
    </svg>
  );
}

export function VolumeOnIcon({ className = 'ico ico-sm' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...baseProps}>
      <path d="M11 5 6 9H2v6h4l5 4V5Z" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}

export function VolumeOffIcon({ className = 'ico ico-sm' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...baseProps}>
      <path d="M11 5 6 9H2v6h4l5 4V5Z" />
      <path d="m22 9-6 6M16 9l6 6" />
    </svg>
  );
}

export function CopyIcon({ className = 'ico ico-sm' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...baseProps}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export function CheckIcon({ className = 'ico ico-sm' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...baseProps}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function PlayIcon({ className = 'ico ico-sm icon-play' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...baseProps}>
      <polygon points="6 4 20 12 6 20 6 4" />
    </svg>
  );
}

export function StopIcon({ className = 'ico ico-sm' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...baseProps}>
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </svg>
  );
}

export function PauseIcon({ className = 'ico ico-sm' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...baseProps}>
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
    </svg>
  );
}

export function DownloadIcon({ className = 'ico ico-sm' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...baseProps}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

export function SlidersIcon({ className = 'ico' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...baseProps}>
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  );
}

export function DatabaseIcon({ className = 'ico ico-sm' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...baseProps}>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14a9 3 0 0 0 18 0V5" />
      <path d="M3 12a9 3 0 0 0 18 0" />
    </svg>
  );
}

export function FlagIcon({ className = 'ico ico-sm' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...baseProps}>
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <line x1="4" y1="22" x2="4" y2="15" />
    </svg>
  );
}

/**
 * Contextual icon cross-fade obeying `better-ui` exact recipe:
 * Both icons stay mounted in one grid cell; 300ms cubic-bezier(0.2, 0, 0, 1).
 */
export function IconSwap({ active, inactiveIcon, activeIcon }) {
  return (
    <span className="icon-swap" data-active={active ? 'true' : 'false'} aria-hidden="true">
      <span className="icon-layer icon-inactive">{inactiveIcon}</span>
      <span className="icon-layer icon-active">{activeIcon}</span>
    </span>
  );
}
