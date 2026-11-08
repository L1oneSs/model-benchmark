import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type Theme = 'light' | 'dark' | 'system';
const ThemeContext = createContext<{theme: Theme; resolved: 'light' | 'dark'; setTheme: (value: Theme) => void}>({theme:'system',resolved:'light',setTheme:()=>{}});
export function ThemeProvider({children}: {children: ReactNode}) {
  const [theme, updateTheme] = useState<Theme>(() => {try {const saved=localStorage.getItem('benchmark-theme');return saved==='light'||saved==='dark'?saved:'system';}catch{return 'system';}});
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  const resolved = theme==='system'?(systemDark?'dark':'light'):theme;
  useEffect(()=>{const media=matchMedia('(prefers-color-scheme: dark)');const change=()=>setSystemDark(media.matches);media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
  useEffect(()=>{document.documentElement.classList.toggle('dark',resolved==='dark');},[resolved]);
  const setTheme=(value:Theme)=>{updateTheme(value);try{localStorage.setItem('benchmark-theme',value);}catch{/* Session-only theme when storage is blocked. */}};
  return <ThemeContext.Provider value={{theme,resolved,setTheme}}>{children}</ThemeContext.Provider>;
}
export const useTheme=()=>useContext(ThemeContext);
