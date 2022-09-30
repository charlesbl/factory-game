export default abstract class Saveable<T> {
    protected init (obj?: T, blob?: any): void {
        if (obj !== undefined) {
            this.fromObj(obj)
        } else if (blob !== undefined) {
            this.fromSave(blob)
        } else {
            throw Error('no data passed')
        }
    }

    protected abstract fromObj: (obj: T) => void
    protected abstract fromSave: (blob: any) => void
    public abstract getObj: () => T
}
