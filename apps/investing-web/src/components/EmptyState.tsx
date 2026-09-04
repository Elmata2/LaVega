import { Card, CardContent } from "./ui/card";

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <Card className="border-dashed bg-transparent shadow-none">
      <CardContent className="flex min-h-56 flex-col items-center justify-center px-6 text-center">
        <div
          className="mb-4 flex h-12 w-12 items-center justify-center rounded-pill bg-secondary text-xl text-primary"
          aria-hidden="true"
        >
          ↗
        </div>
        <h3 className="font-display text-2xl font-semibold">{title}</h3>
        <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}
