import { applyAppearance, DARK_QUERY, readAppearance } from "./appearance";

applyAppearance(readAppearance(), matchMedia(DARK_QUERY).matches);
