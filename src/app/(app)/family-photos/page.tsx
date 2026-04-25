/**
 * Route entry-point for `/family-photos`.
 * Delegates to `FamilyPhotosPage` without any pre-filters so the gallery
 * shows all photos across all events.
 */
import FamilyPhotosPage from "./FamilyPhotosPage";

/** Server/client boundary for the family-photos route. */
export default function FamilyPhotosRoutePage() {
  return <FamilyPhotosPage />;
}
