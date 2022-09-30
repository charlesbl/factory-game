import React from 'react'
import '../css/Factory.css'
import Factory from '../Game/Factory'
import Machine from '../Game/Machine'
import MachineView from './MachineView'
import FactoryCardView from './FactoryCardView'
import IBaseProps from './IBaseProps'

interface IFactoryProps extends IBaseProps {
    factory: Factory
    onSelectedFactory: (factory: Factory) => void
    onUpdateFactoryIO: () => void
}

const renderMachine = (machine: Machine, index: number, onDeleteMachine: () => void, manual: boolean, onTogglePauseMachine?: () => void): JSX.Element => {
    return (
        <div key={index} className="col-12 col-sm-6 col-md-4 col-lg-3 col-xl-2 machine-container">
            <MachineView machine={machine} onDeleteMachine={onDeleteMachine} manual={manual} onTogglePauseMachine={onTogglePauseMachine}/>
        </div>
    )
}

const renderFactoryCard = (factory: Factory, index: number, onClickEnter: () => void, onDeleteFactory: () => void, onActiveAllMachine: () => void): JSX.Element => {
    return (
        <div key={index} className="col-12 col-sm-6 col-md-4 col-lg-3 col-xl-2 machine-container">
            <FactoryCardView factory={factory} onClickEnter={onClickEnter} onDeleteFactory={onDeleteFactory} onToggleAllMachines={onActiveAllMachine} />
        </div>
    )
}

const FactoryView = (props: IFactoryProps): JSX.Element => {
    const onTogglePauseMachine = (): void => {
        // props.factory.updateInputsAndOutputs()
        props.onUpdateFactoryIO()
    }
    const machines = props.factory.machines.map((machine, i) => renderMachine(machine, i, () => props.factory.destroyMachine(machine), false, onTogglePauseMachine))
    const manualMachines = props.game.manualMachines.map((machine, i) => renderMachine(machine, i, () => props.factory.destroyMachine(machine), true))
    const factories = props.factory.factories.map((factory, i) => renderFactoryCard(factory, i, () => props.onSelectedFactory(factory), () => props.factory.destroySubFactory(factory), () => props.onUpdateFactoryIO()))
    return (
        <div>
            <div className="row">
                {manualMachines}
            </div>

            <button className="btn btn-primary" onClick={() => props.factory.updateInputsAndOutputs()}>Refresh</button>
            <div className="row">
                {machines}
            </div>
            <div className="row">
                {factories}
            </div>
        </div>
    )
}

export default FactoryView
