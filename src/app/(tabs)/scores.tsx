import { EmptyState, Screen } from '../../components/ui';
import { PHOTOS } from '../../lib/photos';

/** Scores tab. Saved scores and reports are a later build stage. */
export default function Scores() {
  return (
    <Screen>
      <EmptyState
        photo={PHOTOS.books}
        icon="bar-chart-outline"
        title="No saved scores yet"
        text="Saved scores will show here for each exam and class, with the class average, pass rate, the questions most students missed, and a spreadsheet export."
      />
    </Screen>
  );
}
