import Machine from './Machine'
import Craft from './Craft'
import MachineCraft from './MachineCraft'
import Ingredient from './Ingredient'

export default class Factory {
    private _machines: Machine[]
    private _factories: Factory[]

    public get machines (): Machine[] {
        return this._machines
    }

    public get factories (): Factory[] {
        return this._factories
    }

    public constructor (machines?: Machine[], factories?: Factory[]) {
        if (machines !== undefined) {
            this._machines = machines
        } else {
            this._machines = []
        }

        if (factories !== undefined) {
            this._factories = factories
        } else {
            this._factories = []
        }
    }

    public addSubFactory (): void {
        this._factories.push(new Factory())
    }

    public buildMachine (machineCraft: MachineCraft): Machine {
        const machine = new Machine(machineCraft.name, machineCraft.outputCraft)
        this._machines.push(machine)
        return machine
    }

    public destroyMachine (machine: Machine): void {
        this._machines = this._machines.filter((elem) => {
            return elem !== machine
        })
    }

    public getMachinesOfType (machineCraft: Craft): Machine[] {
        return this._machines.filter((machine) => machine.craft.id === machineCraft.id)
    }

    public destroySubFactory (subFactory: Factory): void {
        subFactory._machines.forEach((machine) => subFactory.destroyMachine(machine))
        subFactory._factories.forEach((factory) => subFactory.destroySubFactory(factory))
        this._factories = this._factories.filter((elem) => {
            return elem !== subFactory
        })
    }

    public get inputs (): Ingredient[] {
        const allInputs: Ingredient[] = []
        allInputs.push(...this._machines.map((machine) => machine.craft.input).flat())
        allInputs.push(...this._factories.map((factory) => factory.inputs).flat())
        return Ingredient.mergeIngredient(allInputs)
    }

    public get outputs (): Ingredient[] {
        const allOutputs: Ingredient[] = []
        allOutputs.push(...this._machines.map((machine) => machine.craft.output).flat())
        allOutputs.push(...this._factories.map((factory) => factory.outputs).flat())
        return Ingredient.mergeIngredient(allOutputs)
    }
}
