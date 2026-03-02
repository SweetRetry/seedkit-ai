import { AnimatePresence, motion } from "motion/react"
import { PartyPopper } from "lucide-react"

interface FirstImageCelebrationProps {
  show: boolean
  onDismiss: () => void
}

export function FirstImageCelebration({ show, onDismiss }: FirstImageCelebrationProps) {
  return (
    <AnimatePresence>
      {show && (
        <motion.button
          type="button"
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="absolute top-6 left-1/2 -translate-x-1/2 z-50 cursor-pointer"
          onClick={onDismiss}
        >
          <div className="flex items-center gap-2.5 rounded-full bg-card border border-border px-4 py-2.5 shadow-lg">
            <PartyPopper size={16} className="text-amber-500" />
            <div className="flex flex-col items-start">
              <span className="text-sm font-semibold">Your first image!</span>
              <span className="text-xs text-muted-foreground">
                Try selecting it and asking AI to create a variation
              </span>
            </div>
          </div>
        </motion.button>
      )}
    </AnimatePresence>
  )
}
