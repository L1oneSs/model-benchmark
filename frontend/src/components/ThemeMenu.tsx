import { Monitor, Moon, Sun } from 'lucide-react';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu';
import { useTheme } from './ThemeProvider';

export function ThemeMenu() {
  const {theme,resolved,setTheme}=useTheme();
  return <DropdownMenu><DropdownMenuTrigger asChild>
    <Button variant="outline" size="sm" aria-label="Выбрать тему">{resolved==='dark'?<Moon/>:<Sun/>}<span className="hidden sm:inline">Тема</span></Button>
  </DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuLabel>Оформление</DropdownMenuLabel><DropdownMenuSeparator/>
    <DropdownMenuRadioGroup value={theme} onValueChange={value=>setTheme(value as typeof theme)}>
      <DropdownMenuRadioItem value="light"><Sun className="mr-2 size-4"/>Светлая</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="dark"><Moon className="mr-2 size-4"/>Тёмная</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="system"><Monitor className="mr-2 size-4"/>Как в системе</DropdownMenuRadioItem>
    </DropdownMenuRadioGroup>
  </DropdownMenuContent></DropdownMenu>;
}
