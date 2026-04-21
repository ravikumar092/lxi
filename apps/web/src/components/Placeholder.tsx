

interface PlaceholderProps {
  icon: any;
  title: string;
  description: string;
}

export const Placeholder: React.FC<PlaceholderProps> = ({ icon: Icon, title, description }) => {
  return (
    <div className="flex flex-col items-center justify-center h-full py-20">
      <div className="p-6 rounded-2xl backdrop-blur-md bg-gradient-to-br from-amber-500/20 to-orange-600/20 border border-amber-500/30 mb-6">
        <Icon className="w-16 h-16 text-amber-600 dark:text-amber-400" />
      </div>
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{title}</h2>
      <p className="text-gray-600 dark:text-gray-400 text-center max-w-md">
        {description}
      </p>
    </div>
  );
};
