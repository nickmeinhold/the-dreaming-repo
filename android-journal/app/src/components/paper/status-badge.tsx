const STATUS_STYLES: Record<string, string> = {
  submitted: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  "under-review": "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  revision: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  accepted: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  published: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
};

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? "bg-gray-100 text-gray-800";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>
      {status}
    </span>
  );
}
