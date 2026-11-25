// `cn()` joins class names and lets later Tailwind classes win ("px-2" then "px-4" → "px-4").
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
