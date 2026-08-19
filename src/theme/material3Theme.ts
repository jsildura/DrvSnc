import { createTheme, ThemeOptions } from '@mui/material/styles';
import {
  oceanLight, oceanDark,
  sunsetLight, sunsetDark,
  forestLight, forestDark,
  emeraldLight, emeraldDark,
  amberLight, amberDark,
  bronzeLight, bronzeDark,
  berryLight, berryDark,
  crimsonLight, crimsonDark,
  driveLight, driveDark,
  indigoLight, indigoDark,
} from './newColorSchemes';

export type ColorScheme = 'default' | 'cool' | 'warm' | 'crimson' | 'morandi' | 'ocean' | 'sunset' | 'forest' | 'emerald' | 'amber' | 'bronze' | 'berry' | 'indigo' | 'drive';

// Material 3 Color Tokens - Default (Purple)
const material3Light = {
  primary: '#6750A4',
  onPrimary: '#FFFFFF',
  primaryContainer: '#EADDFF',
  onPrimaryContainer: '#21005D',
  
  secondary: '#625B71',
  onSecondary: '#FFFFFF',
  secondaryContainer: '#E8DEF8',
  onSecondaryContainer: '#1D192B',
  
  tertiary: '#7D5260',
  onTertiary: '#FFFFFF',
  tertiaryContainer: '#FFD8E4',
  onTertiaryContainer: '#31111D',
  
  error: '#BA1A1A',
  onError: '#FFFFFF',
  errorContainer: '#FFDAD6',
  onErrorContainer: '#410002',
  
  background: '#FFFBFE',
  onBackground: '#1C1B1F',
  
  surface: '#FFFBFE',
  onSurface: '#1C1B1F',
  surfaceVariant: '#E7E0EC',
  onSurfaceVariant: '#49454F',
  
  outline: '#79747E',
  outlineVariant: '#CAC4D0',
  
  shadow: '#000000',
  scrim: '#000000',
  
  inverseSurface: '#313033',
  inverseOnSurface: '#F4EFF4',
  inversePrimary: '#D0BCFF',
};

const material3Dark = {
  primary: '#D0BCFF',
  onPrimary: '#381E72',
  primaryContainer: '#4F378B',
  onPrimaryContainer: '#EADDFF',
  
  secondary: '#CCC2DC',
  onSecondary: '#332D41',
  secondaryContainer: '#4A4458',
  onSecondaryContainer: '#E8DEF8',
  
  tertiary: '#EFB8C8',
  onTertiary: '#492532',
  tertiaryContainer: '#633B48',
  onTertiaryContainer: '#FFD8E4',
  
  error: '#FFB4AB',
  onError: '#690005',
  errorContainer: '#93000A',
  onErrorContainer: '#FFDAD6',
  
  background: '#1C1B1F',
  onBackground: '#E6E1E5',
  
  surface: '#1C1B1F',
  onSurface: '#E6E1E5',
  surfaceVariant: '#49454F',
  onSurfaceVariant: '#CAC4D0',
  
  outline: '#938F99',
  outlineVariant: '#49454F',
  
  shadow: '#000000',
  scrim: '#000000',
  
  inverseSurface: '#E6E1E5',
  inverseOnSurface: '#313033',
  inversePrimary: '#6750A4',
};

// Cool Theme (Blue)
const coolLight = {
  primary: '#0061A4',
  onPrimary: '#FFFFFF',
  primaryContainer: '#D1E4FF',
  onPrimaryContainer: '#001D36',
  
  secondary: '#535F70',
  onSecondary: '#FFFFFF',
  secondaryContainer: '#D7E3F7',
  onSecondaryContainer: '#101C2B',
  
  tertiary: '#6B5778',
  onTertiary: '#FFFFFF',
  tertiaryContainer: '#F2DAFF',
  onTertiaryContainer: '#251431',
  
  error: '#BA1A1A',
  onError: '#FFFFFF',
  errorContainer: '#FFDAD6',
  onErrorContainer: '#410002',
  
  background: '#FCFCFF',
  onBackground: '#1A1C1E',
  
  surface: '#FCFCFF',
  onSurface: '#1A1C1E',
  surfaceVariant: '#DFE2EB',
  onSurfaceVariant: '#43474E',
  
  outline: '#73777F',
  outlineVariant: '#C3C7CF',
  
  shadow: '#000000',
  scrim: '#000000',
  
  inverseSurface: '#2F3033',
  inverseOnSurface: '#F1F0F4',
  inversePrimary: '#9DCAFF',
};

const coolDark = {
  primary: '#9DCAFF',
  onPrimary: '#003258',
  primaryContainer: '#00497D',
  onPrimaryContainer: '#D1E4FF',
  
  secondary: '#BBC7DB',
  onSecondary: '#253140',
  secondaryContainer: '#3B4858',
  onSecondaryContainer: '#D7E3F7',
  
  tertiary: '#D6BEE4',
  onTertiary: '#3B2948',
  tertiaryContainer: '#523F5F',
  onTertiaryContainer: '#F2DAFF',
  
  error: '#FFB4AB',
  onError: '#690005',
  errorContainer: '#93000A',
  onErrorContainer: '#FFDAD6',
  
  background: '#1A1C1E',
  onBackground: '#E2E2E5',
  
  surface: '#1A1C1E',
  onSurface: '#E2E2E5',
  surfaceVariant: '#43474E',
  onSurfaceVariant: '#C3C7CF',
  
  outline: '#8D9199',
  outlineVariant: '#43474E',
  
  shadow: '#000000',
  scrim: '#000000',
  
  inverseSurface: '#E2E2E5',
  inverseOnSurface: '#2F3033',
  inversePrimary: '#0061A4',
};

// Warm Theme (Orange/Red)
const warmLight = {
  primary: '#C4401C',
  onPrimary: '#FFFFFF',
  primaryContainer: '#FFDBD0',
  onPrimaryContainer: '#3A0A00',
  
  secondary: '#77574E',
  onSecondary: '#FFFFFF',
  secondaryContainer: '#FFDBD0',
  onSecondaryContainer: '#2C150F',
  
  tertiary: '#6B5E2F',
  onTertiary: '#FFFFFF',
  tertiaryContainer: '#F5E2A7',
  onTertiaryContainer: '#231B00',
  
  error: '#BA1A1A',
  onError: '#FFFFFF',
  errorContainer: '#FFDAD6',
  onErrorContainer: '#410002',
  
  background: '#FFFBFF',
  onBackground: '#201A18',
  
  surface: '#FFFBFF',
  onSurface: '#201A18',
  surfaceVariant: '#F5DED8',
  onSurfaceVariant: '#53433F',
  
  outline: '#85736E',
  outlineVariant: '#D8C2BC',
  
  shadow: '#000000',
  scrim: '#000000',
  
  inverseSurface: '#362F2D',
  inverseOnSurface: '#FBEEE9',
  inversePrimary: '#FFB599',
};

const warmDark = {
  primary: '#FFB599',
  onPrimary: '#5F1600',
  primaryContainer: '#8B2509',
  onPrimaryContainer: '#FFDBD0',
  
  secondary: '#E7BDB1',
  onSecondary: '#442A22',
  secondaryContainer: '#5D4037',
  onSecondaryContainer: '#FFDBD0',
  
  tertiary: '#D8C68D',
  onTertiary: '#3B2F05',
  tertiaryContainer: '#52451A',
  onTertiaryContainer: '#F5E2A7',
  
  error: '#FFB4AB',
  onError: '#690005',
  errorContainer: '#93000A',
  onErrorContainer: '#FFDAD6',
  
  background: '#201A18',
  onBackground: '#EDE0DC',
  
  surface: '#201A18',
  onSurface: '#EDE0DC',
  surfaceVariant: '#53433F',
  onSurfaceVariant: '#D8C2BC',
  
  outline: '#A08C87',
  outlineVariant: '#53433F',
  
  shadow: '#000000',
  scrim: '#000000',
  
  inverseSurface: '#EDE0DC',
  inverseOnSurface: '#362F2D',
  inversePrimary: '#C4401C',
};

// Pink Theme
const pinkLight = {
  primary: '#B3307A',
  onPrimary: '#FFFFFF',
  primaryContainer: '#FFD9E5',
  onPrimaryContainer: '#3E0021',
  
  secondary: '#74565D',
  onSecondary: '#FFFFFF',
  secondaryContainer: '#FFD9E1',
  onSecondaryContainer: '#2B151B',
  
  tertiary: '#7D5636',
  onTertiary: '#FFFFFF',
  tertiaryContainer: '#FFDCBE',
  onTertiaryContainer: '#2F1500',
  
  error: '#BA1A1A',
  onError: '#FFFFFF',
  errorContainer: '#FFDAD6',
  onErrorContainer: '#410002',
  
  background: '#FFFBFF',
  onBackground: '#201A1B',
  
  surface: '#FFFBFF',
  onSurface: '#201A1B',
  surfaceVariant: '#F3DDE1',
  onSurfaceVariant: '#524345',
  
  outline: '#847375',
  outlineVariant: '#D6C2C5',
  
  shadow: '#000000',
  scrim: '#000000',
  
  inverseSurface: '#352F30',
  inverseOnSurface: '#FAEEEF',
  inversePrimary: '#FFB0D4',
};

const pinkDark = {
  primary: '#FFB0D4',
  onPrimary: '#64003C',
  primaryContainer: '#8A1059',
  onPrimaryContainer: '#FFD9E5',
  
  secondary: '#E5BDC6',
  onSecondary: '#43292F',
  secondaryContainer: '#5B3F45',
  onSecondaryContainer: '#FFD9E1',
  
  tertiary: '#EFBD99',
  onTertiary: '#48290D',
  tertiaryContainer: '#633F21',
  onTertiaryContainer: '#FFDCBE',
  
  error: '#FFB4AB',
  onError: '#690005',
  errorContainer: '#93000A',
  onErrorContainer: '#FFDAD6',
  
  background: '#201A1B',
  onBackground: '#ECE0E1',
  
  surface: '#201A1B',
  onSurface: '#ECE0E1',
  surfaceVariant: '#524345',
  onSurfaceVariant: '#D6C2C5',
  
  outline: '#9F8C8F',
  outlineVariant: '#524345',
  
  shadow: '#000000',
  scrim: '#000000',
  
  inverseSurface: '#ECE0E1',
  inverseOnSurface: '#352F30',
  inversePrimary: '#B3307A',
};

// Morandi Theme (Muted, desaturated)
const morandiLight = {
  primary: '#6B6B6B',
  onPrimary: '#FFFFFF',
  primaryContainer: '#E8E8E8',
  onPrimaryContainer: '#252525',
  
  secondary: '#5E6366',
  onSecondary: '#FFFFFF',
  secondaryContainer: '#E3E8EB',
  onSecondaryContainer: '#1B2023',
  
  tertiary: '#6D5F76',
  onTertiary: '#FFFFFF',
  tertiaryContainer: '#F5E8FF',
  onTertiaryContainer: '#271730',
  
  error: '#BA1A1A',
  onError: '#FFFFFF',
  errorContainer: '#FFDAD6',
  onErrorContainer: '#410002',
  
  background: '#FAFAFA',
  onBackground: '#1A1C1E',
  
  surface: '#FAFAFA',
  onSurface: '#1A1C1E',
  surfaceVariant: '#DFE3E7',
  onSurfaceVariant: '#43474E',
  
  outline: '#73777F',
  outlineVariant: '#C3C7CF',
  
  shadow: '#000000',
  scrim: '#000000',
  
  inverseSurface: '#2F3033',
  inverseOnSurface: '#F1F0F4',
  inversePrimary: '#B8B8B8',
};

const morandiDark = {
  primary: '#B8B8B8',
  onPrimary: '#3E3E3E',
  primaryContainer: '#555555',
  onPrimaryContainer: '#E8E8E8',
  
  secondary: '#C7CCD0',
  onSecondary: '#2F3438',
  secondaryContainer: '#464C50',
  onSecondaryContainer: '#E3E8EB',
  
  tertiary: '#D9C3E3',
  onTertiary: '#3D2D46',
  tertiaryContainer: '#55445D',
  onTertiaryContainer: '#F5E8FF',
  
  error: '#FFB4AB',
  onError: '#690005',
  errorContainer: '#93000A',
  onErrorContainer: '#FFDAD6',
  
  background: '#1A1C1E',
  onBackground: '#E2E2E5',
  
  surface: '#1A1C1E',
  onSurface: '#E2E2E5',
  surfaceVariant: '#43474E',
  onSurfaceVariant: '#C3C7CF',
  
  outline: '#8D9199',
  outlineVariant: '#43474E',
  
  shadow: '#000000',
  scrim: '#000000',
  
  inverseSurface: '#E2E2E5',
  inverseOnSurface: '#2F3033',
  inversePrimary: '#6B6B6B',
};

const colorSchemes = {
  default: { light: material3Light, dark: material3Dark },
  cool: { light: coolLight, dark: coolDark },
  warm: { light: warmLight, dark: warmDark },
  crimson: { light: crimsonLight, dark: crimsonDark },
  morandi: { light: morandiLight, dark: morandiDark },
  ocean: { light: oceanLight, dark: oceanDark },
  sunset: { light: sunsetLight, dark: sunsetDark },
  forest: { light: forestLight, dark: forestDark },
  emerald: { light: emeraldLight, dark: emeraldDark },
  amber: { light: amberLight, dark: amberDark },
  bronze: { light: bronzeLight, dark: bronzeDark },
  berry: { light: berryLight, dark: berryDark },
  indigo: { light: indigoLight, dark: indigoDark },
  drive: { light: driveLight, dark: driveDark },
};

export const createMaterial3Theme = (mode: 'light' | 'dark', colorScheme: ColorScheme = 'drive') => {
  const scheme = colorSchemes[colorScheme] || colorSchemes.drive;
  const colors = mode === 'dark' ? scheme.dark : scheme.light;
  
  const themeOptions: ThemeOptions = {
    palette: {
      mode,
      primary: {
        main: colors.primary,
        contrastText: colors.onPrimary,
        light: colors.primaryContainer,
        dark: colors.onPrimaryContainer,
      },
      secondary: {
        main: colors.secondary,
        contrastText: colors.onSecondary,
        light: colors.secondaryContainer,
        dark: colors.onSecondaryContainer,
      },
      error: {
        main: colors.error,
        contrastText: colors.onError,
        light: colors.errorContainer,
        dark: colors.onErrorContainer,
      },
      background: {
        default: colors.background,
        paper: colors.surface,
      },
      text: {
        primary: colors.onSurface,
        secondary: colors.onSurfaceVariant,
      },
      divider: colors.outlineVariant,
    },
    
    typography: {
      fontFamily: '"Google Sans", "Roboto", "Helvetica", "Arial", sans-serif',
      
      // Material 3 Type Scale
      h1: {
        fontSize: '3.5rem',
        fontWeight: 400,
        lineHeight: 1.2,
        letterSpacing: '-0.02em',
      },
      h2: {
        fontSize: '2.5rem',
        fontWeight: 400,
        lineHeight: 1.3,
        letterSpacing: '-0.01em',
      },
      h3: {
        fontSize: '2rem',
        fontWeight: 400,
        lineHeight: 1.4,
      },
      h4: {
        fontSize: '1.75rem',
        fontWeight: 400,
        lineHeight: 1.4,
      },
      h5: {
        fontSize: '1.5rem',
        fontWeight: 400,
        lineHeight: 1.4,
      },
      h6: {
        fontSize: '1.25rem',
        fontWeight: 500,
        lineHeight: 1.4,
      },
      subtitle1: {
        fontSize: '1rem',
        fontWeight: 500,
        lineHeight: 1.5,
        letterSpacing: '0.01em',
      },
      subtitle2: {
        fontSize: '0.875rem',
        fontWeight: 500,
        lineHeight: 1.5,
        letterSpacing: '0.01em',
      },
      body1: {
        fontSize: '1rem',
        fontWeight: 400,
        lineHeight: 1.5,
        letterSpacing: '0.03em',
      },
      body2: {
        fontSize: '0.875rem',
        fontWeight: 400,
        lineHeight: 1.5,
        letterSpacing: '0.02em',
      },
      button: {
        fontSize: '0.875rem',
        fontWeight: 500,
        lineHeight: 1.75,
        letterSpacing: '0.05em',
        textTransform: 'none',
      },
      caption: {
        fontSize: '0.75rem',
        fontWeight: 400,
        lineHeight: 1.5,
        letterSpacing: '0.04em',
      },
      overline: {
        fontSize: '0.625rem',
        fontWeight: 500,
        lineHeight: 1.5,
        letterSpacing: '0.15em',
        textTransform: 'uppercase',
      },
    },
    
    shape: {
      borderRadius: 12,
    },
    
    spacing: 8, // Base spacing unit (8px)
    // Material 3 spacing scale: 4, 8, 12, 16, 20, 24, 32, 40, 48, 56, 64
    
    shadows: mode === 'dark' ? [
      'none',
      '0px 1px 2px rgba(0, 0, 0, 0.3)',
      '0px 1px 3px rgba(0, 0, 0, 0.4)',
      '0px 2px 4px rgba(0, 0, 0, 0.4)',
      '0px 2px 6px rgba(0, 0, 0, 0.5)',
      '0px 3px 8px rgba(0, 0, 0, 0.5)',
      '0px 4px 10px rgba(0, 0, 0, 0.5)',
      '0px 5px 12px rgba(0, 0, 0, 0.6)',
      '0px 6px 14px rgba(0, 0, 0, 0.6)',
      '0px 7px 16px rgba(0, 0, 0, 0.6)',
      '0px 8px 18px rgba(0, 0, 0, 0.6)',
      '0px 9px 20px rgba(0, 0, 0, 0.7)',
      '0px 10px 22px rgba(0, 0, 0, 0.7)',
      '0px 11px 24px rgba(0, 0, 0, 0.7)',
      '0px 12px 26px rgba(0, 0, 0, 0.7)',
      '0px 13px 28px rgba(0, 0, 0, 0.7)',
      '0px 14px 30px rgba(0, 0, 0, 0.8)',
      '0px 15px 32px rgba(0, 0, 0, 0.8)',
      '0px 16px 34px rgba(0, 0, 0, 0.8)',
      '0px 17px 36px rgba(0, 0, 0, 0.8)',
      '0px 18px 38px rgba(0, 0, 0, 0.8)',
      '0px 19px 40px rgba(0, 0, 0, 0.9)',
      '0px 20px 42px rgba(0, 0, 0, 0.9)',
      '0px 21px 44px rgba(0, 0, 0, 0.9)',
      '0px 22px 46px rgba(0, 0, 0, 0.9)',
    ] : [
      'none',
      '0px 1px 2px rgba(0, 0, 0, 0.05)',
      '0px 1px 3px rgba(0, 0, 0, 0.1)',
      '0px 2px 4px rgba(0, 0, 0, 0.1)',
      '0px 2px 6px rgba(0, 0, 0, 0.1)',
      '0px 3px 8px rgba(0, 0, 0, 0.12)',
      '0px 4px 10px rgba(0, 0, 0, 0.12)',
      '0px 5px 12px rgba(0, 0, 0, 0.14)',
      '0px 6px 14px rgba(0, 0, 0, 0.14)',
      '0px 7px 16px rgba(0, 0, 0, 0.16)',
      '0px 8px 18px rgba(0, 0, 0, 0.16)',
      '0px 9px 20px rgba(0, 0, 0, 0.18)',
      '0px 10px 22px rgba(0, 0, 0, 0.18)',
      '0px 11px 24px rgba(0, 0, 0, 0.2)',
      '0px 12px 26px rgba(0, 0, 0, 0.2)',
      '0px 13px 28px rgba(0, 0, 0, 0.2)',
      '0px 14px 30px rgba(0, 0, 0, 0.22)',
      '0px 15px 32px rgba(0, 0, 0, 0.22)',
      '0px 16px 34px rgba(0, 0, 0, 0.24)',
      '0px 17px 36px rgba(0, 0, 0, 0.24)',
      '0px 18px 38px rgba(0, 0, 0, 0.24)',
      '0px 19px 40px rgba(0, 0, 0, 0.26)',
      '0px 20px 42px rgba(0, 0, 0, 0.26)',
      '0px 21px 44px rgba(0, 0, 0, 0.26)',
      '0px 22px 46px rgba(0, 0, 0, 0.28)',
    ],
    
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            scrollbarWidth: 'thin',
            scrollbarColor: `${colors.outline} ${colors.surface}`,
            '&::-webkit-scrollbar': {
              width: '8px',
              height: '8px',
            },
            '&::-webkit-scrollbar-track': {
              background: colors.surface,
            },
            '&::-webkit-scrollbar-thumb': {
              backgroundColor: colors.outline,
              borderRadius: '4px',
              '&:hover': {
                backgroundColor: colors.onSurfaceVariant,
              },
            },
          },
        },
      },
      
      MuiButton: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            fontWeight: 500,
            borderRadius: 20,
            padding: '10px 24px',
            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            '&:hover': {
              transform: 'translateY(-1px)',
              boxShadow: mode === 'dark' 
                ? '0px 4px 8px rgba(0, 0, 0, 0.6)'
                : '0px 4px 8px rgba(0, 0, 0, 0.15)',
            },
            '&:active': {
              transform: 'translateY(0)',
            },
          },
          contained: {
            boxShadow: mode === 'dark'
              ? '0px 2px 4px rgba(0, 0, 0, 0.5)'
              : '0px 2px 4px rgba(0, 0, 0, 0.1)',
          },
          outlined: {
            borderWidth: '1px',
            borderColor: colors.outline,
            '&:hover': {
              borderWidth: '1px',
              backgroundColor: mode === 'dark' 
                ? 'rgba(208, 188, 255, 0.08)'
                : 'rgba(103, 80, 164, 0.08)',
            },
          },
        },
      },
      
      MuiIconButton: {
        styleOverrides: {
          root: {
            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            '&:hover': {
              backgroundColor: mode === 'dark'
                ? 'rgba(208, 188, 255, 0.12)'
                : 'rgba(103, 80, 164, 0.12)',
              transform: 'scale(1.1)',
            },
            '&:active': {
              transform: 'scale(0.95)',
            },
          },
        },
      },
      
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: 16,
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            '&:hover': {
              transform: 'translateY(-2px)',
              boxShadow: mode === 'dark'
                ? '0px 8px 16px rgba(0, 0, 0, 0.7)'
                : '0px 8px 16px rgba(0, 0, 0, 0.12)',
            },
          },
        },
      },
      
      MuiCardContent: {
        styleOverrides: {
          root: {
            padding: '20px', // Material 3 spacing
            '&:last-child': {
              paddingBottom: '20px',
            },
          },
        },
      },
      
      MuiCardActions: {
        styleOverrides: {
          root: {
            padding: '16px 20px',
          },
        },
      },
      
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            transition: 'box-shadow 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          },
          elevation1: {
            boxShadow: mode === 'dark'
              ? '0px 1px 3px rgba(0, 0, 0, 0.4)'
              : '0px 1px 3px rgba(0, 0, 0, 0.1)',
          },
          elevation2: {
            boxShadow: mode === 'dark'
              ? '0px 2px 6px rgba(0, 0, 0, 0.5)'
              : '0px 2px 6px rgba(0, 0, 0, 0.12)',
          },
          elevation3: {
            boxShadow: mode === 'dark'
              ? '0px 4px 10px rgba(0, 0, 0, 0.6)'
              : '0px 4px 10px rgba(0, 0, 0, 0.14)',
          },
        },
      },
      
      MuiTextField: {
        defaultProps: {
          variant: 'outlined',
        },
        styleOverrides: {
          root: {
            '& .MuiOutlinedInput-root': {
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              '&:hover': {
                '& .MuiOutlinedInput-notchedOutline': {
                  borderColor: colors.primary,
                },
              },
              '&.Mui-focused': {
                '& .MuiOutlinedInput-notchedOutline': {
                  borderWidth: '2px',
                },
              },
            },
          },
        },
      },
      
      MuiChip: {
        styleOverrides: {
          root: {
            fontWeight: 500,
            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            '&:hover': {
              transform: 'scale(1.05)',
            },
          },
        },
      },
      
      MuiLinearProgress: {
        styleOverrides: {
          root: {
            borderRadius: 4,
            height: 8,
          },
          bar: {
            borderRadius: 4,
            transition: 'transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
          },
        },
      },
      
      MuiTabs: {
        styleOverrides: {
          root: {
            '& .MuiTabs-indicator': {
              height: 3,
              borderRadius: '3px 3px 0 0',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            },
          },
        },
      },
      
      MuiTab: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            fontWeight: 500,
            fontSize: '0.875rem',
            minHeight: 48,
            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            '&:hover': {
              backgroundColor: mode === 'dark'
                ? 'rgba(208, 188, 255, 0.08)'
                : 'rgba(103, 80, 164, 0.08)',
            },
          },
        },
      },
      
      MuiSwitch: {
        styleOverrides: {
          root: {
            width: 52,
            height: 32,
            padding: 0,
            '& .MuiSwitch-switchBase': {
              padding: 0,
              margin: 4,
              transitionDuration: '300ms',
              '&.Mui-checked': {
                transform: 'translateX(20px)',
                color: '#fff',
                '& + .MuiSwitch-track': {
                  backgroundColor: colors.primary,
                  opacity: 1,
                  border: 0,
                },
              },
            },
            '& .MuiSwitch-thumb': {
              boxSizing: 'border-box',
              width: 24,
              height: 24,
              boxShadow: '0 2px 4px 0 rgba(0,0,0,0.2)',
            },
            '& .MuiSwitch-track': {
              borderRadius: 32 / 2,
              backgroundColor: colors.surfaceVariant,
              opacity: 1,
              transition: 'background-color 300ms cubic-bezier(0.4, 0, 0.2, 1)',
            },
          },
        },
      },
      
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: 28,
            backgroundImage: 'none',
            padding: '24px',
          },
        },
      },
      
      MuiDialogTitle: {
        styleOverrides: {
          root: {
            padding: '0 0 16px 0',
            fontSize: '1.5rem',
            fontWeight: 400,
          },
        },
      },
      
      MuiDialogContent: {
        styleOverrides: {
          root: {
            padding: '0 0 20px 0',
          },
        },
      },
      
      MuiDialogActions: {
        styleOverrides: {
          root: {
            padding: '24px 0 0 0',
            gap: '8px',
          },
        },
      },
      
      MuiAlert: {
        styleOverrides: {
          root: {
            borderRadius: 12,
            padding: '12px 16px',
            '& .MuiAlert-icon': {
              fontSize: '24px',
              marginRight: '12px',
            },
            '& .MuiAlert-message': {
              padding: '4px 0',
            },
          },
        },
      },
      
      MuiList: {
        styleOverrides: {
          root: {
            padding: '8px 0',
          },
        },
      },
      
      MuiListItem: {
        styleOverrides: {
          root: {
            padding: '12px 16px',
          },
        },
      },
      
      MuiListItemButton: {
        styleOverrides: {
          root: {
            padding: '12px 16px',
            borderRadius: '8px',
            margin: '0 8px',
            '&:hover': {
              backgroundColor: mode === 'dark'
                ? 'rgba(208, 188, 255, 0.08)'
                : 'rgba(103, 80, 164, 0.08)',
            },
          },
        },
      },
      
      MuiToolbar: {
        styleOverrides: {
          root: {
            padding: '8px 16px !important',
            minHeight: '64px',
          },
        },
      },
      
      MuiAppBar: {
        styleOverrides: {
          root: {
            boxShadow: mode === 'dark'
              ? '0px 2px 4px rgba(0, 0, 0, 0.5)'
              : '0px 2px 4px rgba(0, 0, 0, 0.1)',
          },
        },
      },
      
      MuiSnackbar: {
        styleOverrides: {
          root: {
            '& .MuiPaper-root': {
              borderRadius: 12,
            },
          },
        },
      },
    },
  };
  
  return createTheme(themeOptions);
};
