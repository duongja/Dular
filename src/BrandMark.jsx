export default function BrandMark({ small = false }) {
  return (
    <div className={`brandMark ${small ? 'small' : ''}`} aria-label="Dular">
      <img src="/favicon.svg" alt="" aria-hidden="true" />
    </div>
  )
}
