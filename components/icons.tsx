import React from 'react';

type IconProps = React.SVGProps<SVGSVGElement>;

export const FilterIcon: React.FC<IconProps> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" {...props}>
    <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.293.707l-2 2A1 1 0 018 17v-5.586L3.293 6.707A1 1 0 013 6V3z" clipRule="evenodd" />
  </svg>
);

export const PlayIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" {...props}>
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
    </svg>
);

export const PauseIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" {...props}>
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h1a1 1 0 001-1V8a1 1 0 00-1-1H8zm4 0a1 1 0 00-1 1v4a1 1 0 001 1h1a1 1 0 001-1V8a1 1 0 00-1-1h-1z" clipRule="evenodd" />
    </svg>
);

export const ChevronDownIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
);

export const AlertTriangleIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
);

export const InfoIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" {...props}>
        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
    </svg>
);

export const SpinnerIcon: React.FC<IconProps> = (props) => (
    <svg className="animate-spin h-5 w-5 text-gray-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" {...props}>
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
);

export const ErrorIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
);

export const ShieldIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
);

export const PaperPlaneIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" {...props}>
        <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
    </svg>
);

export const ChartIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
);

export const LocationIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
);

export const HomeIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
    </svg>
);

export const MapIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 20.25l6-3.75-6-3.75-6 3.75l6 3.75zM3 13.5l6-3.75 6 3.75-6 3.75-6-3.75zM9 4.5l6 3.75-6 3.75-6-3.75L9 4.5z" />
    </svg>
);

export const ChatIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
);

export const ReportIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
    </svg>
);

export const ProfileIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
);

export const XIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
);

export const PlusIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
);

export const CalendarIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0h18" />
    </svg>
);

export const LocationMarkerIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
    </svg>
);

export const CameraIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.776 48.776 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
    </svg>
);

export const EditIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
    </svg>
);

export const StopIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6" {...props}>
        <path fillRule="evenodd" d="M4.5 7.5a3 3 0 013-3h9a3 3 0 013 3v9a3 3 0 01-3-3h-9a3 3 0 01-3-3v-9z" clipRule="evenodd" />
    </svg>
);

export const SyncIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0011.664 0l3.181-3.183m-3.181-4.991v4.99" />
    </svg>
);

// --- Travel Mode Icons ---
export const CarIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.125-.504 1.125-1.125V14.25m-17.25 4.5v-1.875a3.375 3.375 0 013.375-3.375h9.75a3.375 3.375 0 013.375 3.375v1.875m-17.25 4.5h15m-12-16.5h9" />
    </svg>
);
export const WalkIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
    </svg>
);
export const BikeIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.06 13.94a2.25 2.25 0 013.88 0l2.7 5.292a2.25 2.25 0 01-2.013 3.01H9.373a2.25 2.25 0 01-2.013-3.01l2.7-5.292ZM10.75 4.5a2.25 2.25 0 113.5 0 2.25 2.25 0 01-3.5 0Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 11.25h.008v.008H12v-.008Z" />
    </svg>
);
export const BusIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 12h12M6 12v6h12v-6M6 12H4.5m15 0H18m-12 6H4.5m15 0H18m-12-6a3 3 0 013-3h6a3 3 0 013 3m-12 6a3 3 0 003 3h6a3 3 0 003-3m-12 6V9a3 3 0 013-3h6a3 3 0 013 3v3" />
    </svg>
);

// --- Weather Icons ---
export const SunIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
);
export const MoonIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
    </svg>
);
export const CloudIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
    </svg>
);
export const PartlyCloudyIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707m6.364-1.414a4 4 0 10-5.656-5.656 4 4 0 005.656 5.656z" clipRule="evenodd" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
    </svg>
);
export const RainIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15zM8 19l.01-1m4 1l.01-1m4 1l.01-1" />
    </svg>
);
export const SnowIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15zM19.5 21L12 16.5 4.5 21m0-6.75L12 9l7.5 5.25" />
    </svg>
);
export const WindIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
    </svg>
);

// --- AVATAR ICONS ---
export const AvatarTigerIcon: React.FC<IconProps> = (props) => (
    <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
        <circle cx="50" cy="50" r="50" fill="#F97316"/>
        <path d="M34 50C34 41.1634 41.1634 34 50 34V34C58.8366 34 66 41.1634 66 50V62C66 65.3137 63.3137 68 60 68H40C36.6863 68 34 65.3137 34 62V50Z" fill="#FFEDD5"/>
        <circle cx="43" cy="47" r="4" fill="#1C1917"/>
        <circle cx="57" cy="47" r="4" fill="#1C1917"/>
        <path d="M50 54C52.2091 54 54 52.2091 54 50H46C46 52.2091 47.7909 54 50 54Z" fill="#1C1917"/>
        <path d="M25 40L38 30" stroke="#1C1917" strokeWidth="5" strokeLinecap="round"/>
        <path d="M28 50L40 44" stroke="#1C1917" strokeWidth="5" strokeLinecap="round"/>
        <path d="M33 60L44 55" stroke="#1C1917" strokeWidth="5" strokeLinecap="round"/>
        <path d="M75 40L62 30" stroke="#1C1917" strokeWidth="5" strokeLinecap="round"/>
        <path d="M72 50L60 44" stroke="#1C1917" strokeWidth="5" strokeLinecap="round"/>
        <path d="M67 60L56 55" stroke="#1C1917" strokeWidth="5" strokeLinecap="round"/>
    </svg>
);

export const AvatarElephantIcon: React.FC<IconProps> = (props) => (
    <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
        <circle cx="50" cy="50" r="50" fill="#64748B"/>
        <circle cx="50" cy="50" r="32" fill="#94A3B8"/>
        <path d="M32 40C24 32 30 20 40 24C50 28 48 40 40 42C32 44 34 42 32 40Z" fill="#64748B"/>
        <path d="M68 40C76 32 70 20 60 24C50 28 52 40 60 42C68 44 66 42 68 40Z" fill="#64748B"/>
        <circle cx="45" cy="50" r="3" fill="white"/>
        <circle cx="55" cy="50" r="3" fill="white"/>
        <path d="M50 58C50 58 40 78 35 70C30 62 48 58 50 58Z" fill="#64748B"/>
        <path d="M50 58C50 58 60 78 65 70C70 62 52 58 50 58Z" fill="#64748B"/>
    </svg>
);

export const AvatarBisonIcon: React.FC<IconProps> = (props) => (
    <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
        <circle cx="50" cy="50" r="50" fill="#1E293B"/>
        <path d="M40 68C40 58.0589 48.0589 50 58 50H42C32.0589 50 40 58.0589 40 68Z" fill="#334155"/>
        <rect x="35" y="32" width="30" height="20" rx="10" fill="#334155"/>
        <circle cx="45" cy="42" r="3" fill="#F1F5F9"/>
        <circle cx="55" cy="42" r="3" fill="#F1F5F9"/>
        <path d="M35 32C30 22 20 28 25 35" stroke="#F1F5F9" strokeWidth="5" strokeLinecap="round"/>
        <path d="M65 32C70 22 80 28 75 35" stroke="#F1F5F9" strokeWidth="5" strokeLinecap="round"/>
    </svg>
);

export const AvatarLeopardIcon: React.FC<IconProps> = (props) => (
    <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
        <circle cx="50" cy="50" r="50" fill="#F59E0B"/>
        <path d="M50 50C50 41.1634 57.1634 34 66 34V34C74.8366 34 82 41.1634 82 50V62C82 65.3137 79.3137 68 76 68H54C51.6863 68 50 66.3137 50 64V50Z" fill="#FEF3C7"/>
        <path d="M50 50C50 41.1634 42.8366 34 34 34V34C25.1634 34 18 41.1634 18 50V62C18 65.3137 20.6863 68 24 68H46C48.3137 68 50 66.3137 50 64V50Z" fill="#FEF3C7"/>
        <circle cx="43" cy="47" r="4" fill="#1C1917"/>
        <circle cx="57" cy="47" r="4" fill="#1C1917"/>
        <path d="M50 54C52.2091 54 54 52.2091 54 50H46C46 52.2091 47.7909 54 50 54Z" fill="#1C1917"/>
        <circle cx="25" cy="30" r="3" fill="#1C1917"/>
        <circle cx="75" cy="30" r="3" fill="#1C1917"/>
        <circle cx="35" cy="75" r="4" fill="#1C1917"/>
        <circle cx="65" cy="75" r="4" fill="#1C1917"/>
        <circle cx="80" cy="55" r="2" fill="#1C1917"/>
        <circle cx="20" cy="55" r="2" fill="#1C1917"/>
    </svg>
);

export const AvatarBearIcon: React.FC<IconProps> = (props) => (
    <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
        <circle cx="50" cy="50" r="50" fill="#78350F"/>
        <circle cx="50" cy="58" r="22" fill="#A16207"/>
        <circle cx="50" cy="50" r="25" fill="#522204"/>
        <circle cx="42" cy="48" r="3" fill="white"/>
        <circle cx="58" cy="48" r="3" fill="white"/>
        <path d="M30 35C25 25 35 20 40 28" fill="#522204"/>
        <path d="M70 35C75 25 65 20 60 28" fill="#522204"/>
    </svg>
);

export const AvatarRhinoIcon: React.FC<IconProps> = (props) => (
    <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
        <circle cx="50" cy="50" r="50" fill="#4B5563"/>
        <rect x="25" y="40" width="50" height="30" rx="15" fill="#6B7280"/>
        <circle cx="40" cy="55" r="4" fill="#111827"/>
        <path d="M65 40C65 40 75 30 70 25C65 20 60 38 65 40Z" fill="#9CA3AF"/>
        <path d="M28 35C22 30 25 25 32 28" fill="#6B7280"/>
    </svg>
);