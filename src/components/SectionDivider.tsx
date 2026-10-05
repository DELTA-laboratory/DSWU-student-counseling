import React from 'react';
import { motion } from 'framer-motion';

interface SectionDividerProps {
  label?: string;
  title?: string;
  description?: string;
  sublabel?: string;
  badge?: string;
  icon?: React.ReactNode;
  step?: string;
  className?: string;
  dotColor?: string;
}

export const SectionDivider: React.FC<SectionDividerProps> = ({
  label,
  title,
  description,
  sublabel,
  badge,
  icon,
  step,
  className = 'mt-12 mb-7',
}) => {
  const displayTitle = title || label || '';
  const displayDesc = description || sublabel || '';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-20px' }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className={`relative w-full ${className}`}
    >
      {/* Top subtle divider rule */}
      <div className="h-px w-full bg-neutral-200/80 mb-6" />

      {/* Prominent Modern Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-2">
        <div className="flex items-start gap-4">
          {icon ? (
            <div className="w-12 h-12 rounded-2xl bg-[#FDF2F6] border border-[#F5C2D7]/70 text-[#B70050] flex items-center justify-center shrink-0 mt-0.5">
              {icon}
            </div>
          ) : (
            <div className="w-1.5 h-8 rounded-full bg-[#B70050] shrink-0 mt-1" />
          )}

          <div>
            {step && (
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-bold tracking-wider text-[#B70050] uppercase">
                  {step}
                </span>
                {badge && (
                  <>
                    <span className="text-neutral-300" aria-hidden="true">·</span>
                    <span className="text-xs font-medium text-neutral-500">
                      {badge}
                    </span>
                  </>
                )}
              </div>
            )}
            <h3 className="text-xl sm:text-2xl font-bold text-neutral-900 tracking-tight">
              {displayTitle}
            </h3>
            {displayDesc && (
              <p className="text-sm sm:text-base text-neutral-500 mt-1 leading-relaxed font-normal">
                {displayDesc}
              </p>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
};
