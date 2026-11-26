import { EmptyState, Screen } from '../../components/ui';
import { PHOTOS } from '../../lib/photos';

/** Scan tab. Scanning is a later build stage. */
export default function Scan() {
  return (
    <Screen>
      <EmptyState
        photo={PHOTOS.pencils}
        icon="scan-outline"
        title="Scanning comes soon"
        text="Here you will pick an exam and scan each script with the camera. Skora shows the score, then you type the student's name and save it, or discard it."
      />
    </Screen>
  );
}
