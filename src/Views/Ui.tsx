import React from 'react'

export type IconName = 'arrow' | 'back' | 'box' | 'check' | 'chevron' | 'factory' | 'hammer' | 'layers' | 'menu' | 'pause' | 'play' | 'plus' | 'power' | 'search' | 'settings' | 'spark' | 'trash' | 'wrench' | 'x'

interface IIconProps {
    name: IconName
    size?: number
    className?: string
}

export const Icon = ({ name, size = 18, className = '' }: IIconProps): JSX.Element => {
    const common = { strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
    const paths: Record<IconName, JSX.Element> = {
        arrow: <>
            <path d="M5 12h14" />

            <path d="m13 6 6 6-6 6" />
        </>,
        back: <>
            <path d="m15 18-6-6 6-6" />

            <path d="M9 12h10" />
        </>,
        box: <>
            <path d="m4 7 8-4 8 4-8 4-8-4Z" />

            <path d="M4 7v10l8 4 8-4V7M12 11v10" />
        </>,
        check: <path d="m5 12 4 4L19 6" />,
        chevron: <path d="m8 10 4 4 4-4" />,
        factory: <>
            <path d="M3 21V9l6 3V8l6 4V5h4v16Z" />

            <path d="M7 21v-4h4v4M15 16h2" />
        </>,
        hammer: <>
            <path d="m14 5 5 5" />

            <path d="m16 3 5 5-3 3-5-5Z" />

            <path d="M14 8 4 18a2.1 2.1 0 0 0 3 3L17 11" />
        </>,
        layers: <>
            <path d="m12 3 9 5-9 5-9-5 9-5Z" />

            <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
        </>,
        menu: <>
            <path d="M4 7h16M4 12h16M4 17h16" />
        </>,
        pause: <>
            <path d="M9 5v14M15 5v14" />
        </>,
        play: <path d="m8 5 11 7-11 7Z" />,
        plus: <>
            <path d="M12 5v14M5 12h14" />
        </>,
        power: <>
            <path d="M12 3v9" />

            <path d="M7.1 5.8a8 8 0 1 0 9.8 0" />
        </>,
        search: <>
            <circle
                cx="11"
                cy="11"
                r="7"
            />

            <path d="m20 20-4-4" />
        </>,
        settings: <>
            <circle
                cx="12"
                cy="12"
                r="3"
            />

            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
        </>,
        spark: <>
            <path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z" />

            <path d="m18 15 .8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8L18 15Z" />
        </>,
        trash: <>
            <path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6" />
        </>,
        wrench: <>
            <path d="M14.5 6.5a4 4 0 0 0-5-5l2.2 2.2-2.8 2.8-2.2-2.2a4 4 0 0 0 5 5L20 17.6a1.7 1.7 0 1 1-2.4 2.4l-8.3-8.3" />
        </>,
        x: <>
            <path d="m6 6 12 12M18 6 6 18" />
        </>
    }

    return (
        <svg
            aria-hidden="true"
            className={`icon ${className}`}
            fill="none"
            height={size}
            stroke="currentColor"
            strokeWidth="1.8"
            viewBox="0 0 24 24"
            width={size}
            {...common}
        >
            {paths[name]}
        </svg>
    )
}

export interface IItemVisual {
    code: string
    tone: string
}

export const getItemVisual = (itemId: string): IItemVisual => {
    const visuals: Record<string, IItemVisual> = {
        ironOre: { code: 'Fe', tone: 'iron' },
        ironIngot: { code: 'Fe', tone: 'steel' },
        ironPlate: { code: '▱', tone: 'plate' },
        copperOre: { code: 'Cu', tone: 'copper' },
        copperIngot: { code: 'Cu', tone: 'copper-light' },
        copperPlate: { code: '▱', tone: 'copper-plate' },
        copperWire: { code: '∿', tone: 'wire' },
        circuit: { code: '⌘', tone: 'circuit' }
    }
    return visuals[itemId] ?? { code: '•', tone: 'default' }
}

export const formatQuantity = (value: number, maximumFractionDigits = 1): string => new Intl.NumberFormat('fr-FR', {
    maximumFractionDigits,
    minimumFractionDigits: value > 0 && value < 1 ? 1 : 0
}).format(value)
