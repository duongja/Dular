export default function BrandMark({ small = false }) {
  return (
    <div className={`brandMark ${small ? 'small' : ''}`} aria-label="Dular">
      <span>D</span>
    </div>
  )
}
