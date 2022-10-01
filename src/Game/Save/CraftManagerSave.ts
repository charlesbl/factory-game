import CraftManager from '../CraftManager'
import CraftSave from './CraftSave'
import MachineCraftSave from './MachineCraftSave'
import Saveable from './Saveable'

export default class CraftManagerSave extends Saveable<CraftManager> {
    private customCrafts!: CraftSave[]
    private customMachineCrafts!: MachineCraftSave[]

    public constructor (obj?: CraftManager, blob?: CraftManagerSave) {
        super()
        this.init(obj, blob)
    }

    protected readonly fromObj = (craftManager: CraftManager): void => {
        this.customCrafts = craftManager.customCrafts.map((cc) => new CraftSave(cc))
        this.customMachineCrafts = craftManager.customMachineCrafts.map((cc) => new MachineCraftSave(cc))
    }

    protected readonly fromSave = (blob: CraftManagerSave): void => {
        this.customCrafts = blob.customCrafts.map((cc) => new CraftSave(undefined, cc))
        this.customMachineCrafts = blob.customMachineCrafts.map((cc) => new MachineCraftSave(undefined, cc))
    }

    public readonly getObj = (): CraftManager => {
        const cm = new CraftManager(this.customCrafts.map((ccSave) => ccSave.getObj()), [])
        this.customMachineCrafts.map((cmcSave) => cmcSave.getObj(cm)).forEach((cmc) => cm.addMachineCraft(cmc))
        return cm
    }
}
