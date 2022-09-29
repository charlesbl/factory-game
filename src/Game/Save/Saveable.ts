export default abstract class Saveable<T> {
    init (obj?: T, blob?: any): void {
        if (obj !== undefined) {
            this.fromObj(obj)
        } else if (blob !== undefined) {
            this.fromSave(blob)
        } else {
            throw Error('no data passed')
        }
    }

    abstract fromObj: (obj: T) => void
    abstract fromSave: (blob: any) => void
    abstract getObj: () => T
}
