interface CardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: string;
  trend?: "up" | "down" | "neutral";
  color?: "blue" | "green" | "yellow" | "red" | "purple";
}

const colorClasses = {
  blue: "from-blue-600 to-blue-700",
  green: "from-green-600 to-green-700",
  yellow: "from-yellow-600 to-yellow-700",
  red: "from-red-600 to-red-700",
  purple: "from-purple-600 to-purple-700",
};

export default function Card({
  title,
  value,
  subtitle,
  icon,
  color = "blue",
}: CardProps) {
  return (
    <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 hover:border-gray-600 transition-colors">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-gray-400 text-sm font-medium">{title}</p>
          <p className="text-3xl font-bold text-white mt-2">{value}</p>
          {subtitle && (
            <p className="text-gray-500 text-sm mt-1">{subtitle}</p>
          )}
        </div>
        {icon && (
          <div
            className={`w-12 h-12 rounded-lg bg-gradient-to-br ${colorClasses[color]} flex items-center justify-center text-2xl`}
          >
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}

export function ActionButton({
  onClick,
  children,
  loading = false,
  variant = "primary",
}: {
  onClick: () => void;
  children: React.ReactNode;
  loading?: boolean;
  variant?: "primary" | "secondary";
}) {
  const baseClasses =
    "px-4 py-2 rounded-lg font-medium text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed";
  const variantClasses =
    variant === "primary"
      ? "bg-blue-600 hover:bg-blue-700 text-white"
      : "bg-gray-700 hover:bg-gray-600 text-gray-200";

  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`${baseClasses} ${variantClasses}`}
    >
      {loading ? (
        <span className="flex items-center gap-2">
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
              fill="none"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          Syncing...
        </span>
      ) : (
        children
      )}
    </button>
  );
}
